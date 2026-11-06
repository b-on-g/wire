namespace $ {

	type Type = $bog_wire_check_type
	type Expr = $bog_wire_ast_expr
	type Member = $bog_wire_ast_member
	type Owner = Extract< $bog_wire_ast_decl, { kind: 'object' } >
	type Shape = Extract< $bog_wire_ast_decl, { kind: 'record' } >

	type Param = { c: string, type: Type }

	type Ctx = {
		lines: string[]
		params: Map< string, Param >
		owner: Owner
	}

	const boxed = new Set([ 'text', 'list', 'maybe', 'record', 'none' ])

	const kinds: { [ kind: string ]: string } = {
		int: 'WIRE_INT',
		float: 'WIRE_FLOAT',
		bool: 'WIRE_BOOL',
		text: 'WIRE_TEXT',
		list: 'WIRE_LIST',
		maybe: 'WIRE_MAYBE',
		none: 'WIRE_MAYBE',
		record: 'WIRE_RECORD',
		object: 'WIRE_OBJECT',
		void: 'WIRE_VOID',
		never: 'WIRE_VOID',
	}

	function cstr( text: string ) {
		let out = '"'
		for( const byte of new TextEncoder().encode( text ) ) {
			const char = String.fromCharCode( byte )
			if( byte >= 0x20 && byte < 0x7f && char !== '"' && char !== '\\' && char !== '?' ) out += char
			else out += '\\' + byte.toString( 8 ).padStart( 3, '0' )
		}
		return out + '"'
	}

	function bytes( text: string ) {
		return new TextEncoder().encode( text ).length
	}

	function key( type: Type ): string {
		switch( type.kind ) {
			case 'list': return `list(${ key( type.item ) })`
			case 'maybe': return `maybe(${ key( type.item ) })`
			case 'record': return type.name
			case 'object': return type.name
			case 'method': return `${ type.owner }.${ type.member }`
			default: return type.kind
		}
	}

	export class $bog_wire_emit {

		temps = 0

		sites = 0

		type_names = new Map< string, string >()

		type_decls = [] as string[]

		type_defs = [] as string[]

		protos = [] as string[]

		descriptors = [] as string[]

		bodies = [] as string[]

		slots = new Map< Member, number >()

		binds = new Map< Member, number >()

		constructor( readonly check: $bog_wire_check ) {}

		c( fqn: string ) {
			return fqn.slice( 1 )
		}

		decl( name: string ) {
			return this.check.decls.get( name )!
		}

		member( owner: string, name: string ) {
			const decl = this.decl( owner ) as Owner
			return { decl, member: decl.members.find( member => member.name === name )! }
		}

		type( type: Type ): string {
			const id = key( type )
			const known = this.type_names.get( id )
			if( known ) return `&${ known }`

			const name = `T${ this.type_names.size }`
			this.type_names.set( id, name )
			this.type_decls.push( `static const wire_type ${ name };` )

			if( type.kind === 'list' || type.kind === 'maybe' ) {
				const item = this.type( type.item )
				this.type_defs.push( `static const wire_type ${ name } = { ${ kinds[ type.kind ] }, ${ item }, 0, NULL };` )
			} else if( type.kind === 'none' ) {
				const item = this.type({ kind: 'void' })
				this.type_defs.push( `static const wire_type ${ name } = { WIRE_MAYBE, ${ item }, 0, NULL };` )
			} else if( type.kind === 'record' ) {
				const shape = this.decl( type.name ) as Shape
				const fields = shape.fields.map( field => this.type( this.check.type( field.type ) ) )
				this.type_defs.push( `static const wire_type* const ${ name }_fields[] = { ${ fields.join( ', ' ) } };` )
				this.type_defs.push( `static const wire_type ${ name } = { WIRE_RECORD, NULL, ${ fields.length }, ${ name }_fields };` )
			} else {
				this.type_defs.push( `static const wire_type ${ name } = { ${ kinds[ type.kind ] }, NULL, 0, NULL };` )
			}

			return `&${ name }`
		}

		temp() {
			return `t${ ++this.temps }`
		}

		of( expr: Expr ) {
			return this.check.types.get( expr )!
		}

		release( ctx: Ctx, name: string, type: Type ) {
			if( name && boxed.has( type.kind ) ) ctx.lines.push( `wire_release( ${ this.type( type ) }, ${ name } );` )
		}

		retain( ctx: Ctx, name: string, type: Type ) {
			if( boxed.has( type.kind ) ) ctx.lines.push( `wire_retain( ${ this.type( type ) }, ${ name } );` )
		}

		coerce( ctx: Ctx, name: string, from: Type, to: Type ) {
			if( to.kind !== 'maybe' ) return name
			if( [ 'maybe', 'none', 'never', 'error' ].includes( from.kind ) ) return name
			const out = this.temp()
			ctx.lines.push( `wire_val ${ out } = wire_some_new( ${ this.type( to ) }, ${ name } );` )
			return out
		}

		unite( left: Type, right: Type ): Type {
			if( left.kind === 'never' ) return right
			if( right.kind === 'never' ) return left
			if( left.kind === 'none' ) return right.kind === 'maybe' || right.kind === 'none' ? right : { kind: 'maybe', item: right }
			if( right.kind === 'none' ) return this.unite( right, left )
			if( right.kind === 'maybe' && left.kind !== 'maybe' ) return right
			if( left.kind === 'list' && right.kind === 'list' ) return { kind: 'list', item: this.unite( left.item, right.item ) }
			return left
		}

		block( ctx: Ctx, task: ()=> void ) {
			const outer = ctx.lines
			ctx.lines = []
			task()
			const inner = ctx.lines
			ctx.lines = outer
			return inner.map( line => '\t' + line )
		}

		members( owner: Owner ) {
			let atoms = 0
			let maps = 0
			let binds = 0

			for( const member of owner.members ) {
				if( member.kind === 'action' ) continue
				if( member.kind === 'abstract' ) this.binds.set( member, binds++ )
				if( this.check.keys( member ).length ) this.slots.set( member, maps++ )
				else this.slots.set( member, atoms++ )
			}

			return { atoms, maps, binds }
		}

		descriptor( owner: Owner, member: Exclude< Member, { kind: 'action' } > ) {
			const name = `${ this.c( owner.name ) }__${ member.name }`
			const keys = this.check.keys( member )
			const type = this.type( this.check.value_type( owner, member ) )
			const solid = member.kind === 'memo' && member.solid

			let key_types = 'NULL'
			if( keys.length ) {
				key_types = `K_${ name }`
				this.descriptors.push( `static const wire_type* const ${ key_types }[] = { ${ keys.map( param => this.type( this.check.type( param.type ) ) ).join( ', ' ) } };` )
			}

			this.protos.push( `static void F_${ name }( wire_obj* self, const wire_val* keys, const wire_val* next, wire_val* out );` )
			this.descriptors.push( `static const wire_member M_${ name } = { ${ cstr( member.name ) }, ${ type }, ${ solid }, ${ keys.length }, ${ key_types }, F_${ name }, ${ this.slots.get( member ) } };` )
		}

		memo( owner: Owner, member: Exclude< Member, { kind: 'action' } > ) {
			const name = `${ this.c( owner.name ) }__${ member.name }`
			const ctx: Ctx = { lines: [], params: new Map, owner }

			if( member.kind === 'abstract' ) {
				ctx.lines.push( `self->binds[ ${ this.binds.get( member ) } ]( self, out );` )
			} else {
				const scope = this.check.scopes.get( member )!
				let index = 0
				let next = ''

				for( const param of member.params ) {
					const type = scope.params.get( param.name )!
					if( !param.next ) {
						ctx.params.set( param.name, { c: `keys[ ${ index++ } ]`, type } )
						continue
					}
					next = 'p_next'
					const declared = this.check.type( param.type )
					ctx.lines.push( `wire_val p_next = { .box = NULL };` )
					if( declared.kind === 'maybe' ) {
						ctx.lines.push( `if( next ) { p_next = *next; wire_retain( ${ this.type( type ) }, p_next ); }` )
					} else {
						ctx.lines.push( `if( next ) { wire_val held = *next; wire_retain( ${ this.type( declared ) }, held ); p_next = wire_some_new( ${ this.type( type ) }, held ); }` )
					}
					ctx.params.set( param.name, { c: 'p_next', type } )
				}

				const result = this.expr( member.body, ctx )
				const value = this.coerce( ctx, result, this.of( member.body ), this.check.value_type( owner, member ) )
				ctx.lines.push( `*out = ${ value };` )
				if( next ) this.release( ctx, next, ctx.params.get( member.params.at( -1 )!.name )!.type )
			}

			this.bodies.push( [
				`static void F_${ name }( wire_obj* self, const wire_val* keys, const wire_val* next, wire_val* out ) {`,
				`\t( void ) self; ( void ) keys; ( void ) next;`,
				... ctx.lines.map( line => '\t' + line ),
				`}`,
			].join( '\n' ) )
		}

		action( owner: Owner, member: Extract< Member, { kind: 'action' } > ) {
			const name = `${ this.c( owner.name ) }__${ member.name }`
			const ctx: Ctx = { lines: [], params: new Map, owner }
			const scope = this.check.scopes.get( member )!

			member.params.forEach( ( param, index ) => {
				ctx.params.set( param.name, { c: `args[ ${ index } ]`, type: scope.params.get( param.name )! } )
			} )

			for( const statement of member.body ) {
				const result = this.expr( statement, ctx )
				this.release( ctx, result, this.of( statement ) )
			}

			this.protos.push( `static void A_${ name }( wire_obj* self, const wire_val* args );` )
			this.bodies.push( [
				`static void A_${ name }( wire_obj* self, const wire_val* args ) {`,
				`\t( void ) self; ( void ) args;`,
				... ctx.lines.map( line => '\t' + line ),
				`}`,
			].join( '\n' ) )
		}

		args( ctx: Ctx, args: Expr[], types: Type[] ) {
			const values = args.map( ( arg, index ) => this.coerce( ctx, this.expr( arg, ctx ), this.of( arg ), types[ index ] ) )
			if( !values.length ) return { array: 'NULL', values, types }
			const array = this.temp()
			ctx.lines.push( `wire_val ${ array }[] = { ${ values.join( ', ' ) } };` )
			return { array, values, types }
		}

		release_args( ctx: Ctx, args: { values: string[], types: Type[] } ) {
			args.values.forEach( ( value, index ) => this.release( ctx, value, args.types[ index ] ) )
		}

		target( ctx: Ctx, callee: Expr ) {
			if( callee.kind === 'field' ) {
				const target = this.expr( callee.target, ctx )
				return `${ target }.obj`
			}
			return 'self'
		}

		expr( expr: Expr, ctx: Ctx ): string {
			const type = this.of( expr )
			const out = this.temp()
			const push = ( line: string )=> ctx.lines.push( line )

			switch( expr.kind ) {

				case 'number':
					push( `wire_val ${ out } = { .${ expr.float ? 'f' : 'i' } = ${ expr.value } };` )
					return out

				case 'bool':
					push( `wire_val ${ out } = { .b = ${ expr.value } };` )
					return out

				case 'none':
					push( `wire_val ${ out } = { .box = NULL };` )
					return out

				case 'text': {
					if( expr.parts.every( part => typeof part === 'string' ) ) {
						const text = ( expr.parts as string[] ).join( '' )
						push( `wire_val ${ out } = wire_text_lit( ${ cstr( text ) }, ${ bytes( text ) } );` )
						return out
					}
					const buf = this.temp()
					push( `wire_buf ${ buf } = { 0 };` )
					for( const part of expr.parts ) {
						if( typeof part === 'string' ) {
							push( `wire_buf_lit( &${ buf }, ${ cstr( part ) }, ${ bytes( part ) } );` )
							continue
						}
						const value = this.expr( part, ctx )
						const kind = this.of( part ).kind
						if( kind === 'text' ) push( `wire_buf_text( &${ buf }, ${ value } );` )
						else push( `wire_buf_${ kind }( &${ buf }, ${ value }.${ kind === 'int' ? 'i' : kind === 'float' ? 'f' : 'b' } );` )
						this.release( ctx, value, this.of( part ) )
					}
					push( `wire_val ${ out } = wire_buf_done( &${ buf } );` )
					return out
				}

				case 'name': {
					const ref = this.check.refs.get( expr )!
					if( ref.kind === 'param' ) {
						const param = ctx.params.get( expr.name )!
						push( `wire_val ${ out } = ${ param.c };` )
						this.retain( ctx, out, param.type )
						return out
					}
					const { decl, member } = this.member( ( ref as { owner: string } ).owner, expr.name )
					push( `wire_val ${ out } = wire_read( self, &M_${ this.c( decl.name ) }__${ member.name }, NULL, NULL );` )
					return out
				}

				case 'field': {
					const target = this.expr( expr.target, ctx )
					const target_type = this.of( expr.target )

					if( !expr.maybe ) {
						const value = this.access( ctx, expr, target )
						this.release( ctx, target, target_type )
						return value
					}

					const inner = this.temp()
					push( `wire_val ${ out } = { .box = NULL };` )
					push( `if( ${ target }.box ) {` )
					ctx.lines.push( ... this.block( ctx, ()=> {
						push( `wire_val ${ inner } = ( ( wire_some* ) ${ target }.box )->value;` )
						const value = this.access( ctx, expr, inner )
						const field = this.field_type( expr )
						push( `${ out } = ${ this.coerce( ctx, value, field, type ) };` )
					} ) )
					push( `}` )
					this.release( ctx, target, target_type )
					return out
				}

				case 'call': return this.call( expr, ctx, out )

				case 'make': return this.make( expr, ctx, out )

				case 'list': {
					const builder = this.temp()
					const item = ( type as { item: Type } ).item
					push( `wire_list_builder ${ builder };` )
					push( `wire_list_begin( &${ builder }, ${ this.type( type ) } );` )
					for( const entry of expr.items ) {
						if( entry.kind === 'spread' ) {
							const spread = this.expr( entry.value, ctx )
							push( `wire_list_add_all( &${ builder }, ${ spread } );` )
							this.release( ctx, spread, this.of( entry.value ) )
							continue
						}
						const value = this.coerce( ctx, this.expr( entry, ctx ), this.of( entry ), item )
						push( `wire_list_add( &${ builder }, ${ value } );` )
					}
					push( `wire_val ${ out } = wire_list_end( &${ builder } );` )
					return out
				}

				case 'unary': {
					const value = this.expr( expr.value, ctx )
					if( expr.op === '!' ) push( `wire_val ${ out } = { .b = !${ value }.b };` )
					else if( type.kind === 'float' ) push( `wire_val ${ out } = { .f = -${ value }.f };` )
					else push( `wire_val ${ out } = { .i = -${ value }.i };` )
					return out
				}

				case 'binary': return this.binary( expr, ctx, out )

				case 'cond': {
					const test = this.expr( expr.test, ctx )
					push( `wire_val ${ out };` )
					push( `if( ${ test }.b ) {` )
					ctx.lines.push( ... this.block( ctx, ()=> {
						const value = this.expr( expr.then, ctx )
						push( `${ out } = ${ this.coerce( ctx, value, this.of( expr.then ), type ) };` )
					} ) )
					push( `} else {` )
					ctx.lines.push( ... this.block( ctx, ()=> {
						const value = this.expr( expr.else, ctx )
						push( `${ out } = ${ this.coerce( ctx, value, this.of( expr.else ), type ) };` )
					} ) )
					push( `}` )
					return out
				}

				case 'spread': throw new Error( 'Spread outside list' )

			}
		}

		field_type( expr: Extract< Expr, { kind: 'field' } > ): Type {
			const ref = this.check.refs.get( expr )!
			if( ref.kind === 'member' ) {
				const { decl, member } = this.member( ref.owner, ref.member )
				return this.check.value_type( decl, member )
			}
			if( ref.kind === 'field' ) {
				const shape = this.decl( ref.record ) as Shape
				return this.check.type( shape.fields[ ref.index ].type )
			}
			const target = this.of( expr.target )
			const list = ( target.kind === 'maybe' ? target.item : target ) as { item: Type }
			if( ( ref as { op: string } ).op === 'size' ) return { kind: 'int' }
			return list.item.kind === 'never' ? { kind: 'int' } : list.item
		}

		access( ctx: Ctx, expr: Extract< Expr, { kind: 'field' } >, target: string ): string {
			const ref = this.check.refs.get( expr )!
			const out = this.temp()

			if( ref.kind === 'member' ) {
				ctx.lines.push( `wire_val ${ out } = wire_read( ${ target }.obj, &M_${ this.c( ref.owner ) }__${ ref.member }, NULL, NULL );` )
			} else if( ref.kind === 'field' ) {
				ctx.lines.push( `wire_val ${ out } = wire_record_get( ${ target }, ${ ref.index } );` )
			} else if( ref.kind === 'list' && ref.op === 'size' ) {
				ctx.lines.push( `wire_val ${ out } = { .i = wire_list_size( ${ target } ) };` )
			} else {
				ctx.lines.push( `wire_val ${ out } = wire_list_sum( ${ target } );` )
			}

			return out
		}

		method( ctx: Ctx, arg: Expr ) {
			const ref = this.check.refs.get( arg ) as { owner: string, member: string }
			const owner = arg.kind === 'field' ? `${ this.expr( arg.target, ctx ) }.obj` : 'self'
			const { decl, member } = this.member( ref.owner, ref.member )
			return { owner, descriptor: `&M_${ this.c( decl.name ) }__${ member.name }`, value: this.check.value_type( decl, member ) }
		}

		call( expr: Extract< Expr, { kind: 'call' } >, ctx: Ctx, out: string ): string {
			const ref = this.check.refs.get( expr )!
			const push = ( line: string )=> ctx.lines.push( line )

			if( ref.kind === 'assert' ) {
				const value = this.expr( expr.args[0], ctx )
				push( `wire_assert( ${ value }.b, ${ cstr( `${ expr.span.uri }:${ expr.span.row }:${ expr.span.col }` ) } );` )
				return ''
			}

			if( ref.kind === 'print' ) {
				const value = this.expr( expr.args[0], ctx )
				push( `wire_print( ${ value } );` )
				this.release( ctx, value, { kind: 'text' } )
				return ''
			}

			if( ref.kind === 'after' ) {
				const arg = expr.args[0]
				const owner = arg.kind === 'field' ? `${ this.expr( arg.target, ctx ) }.obj` : 'self'
				push( `wire_after( ${ owner }, A_${ this.c( ref.owner ) }__${ ref.member } );` )
				return ''
			}

			if( ref.kind === 'list' && ref.op === 'join' ) {
				const callee = expr.callee as Extract< Expr, { kind: 'field' } >
				const list = this.expr( callee.target, ctx )
				const separator = this.expr( expr.args[0], ctx )
				push( `wire_val ${ out } = wire_list_join( ${ list }, ${ separator } );` )
				this.release( ctx, list, this.of( callee.target ) )
				this.release( ctx, separator, { kind: 'text' } )
				return out
			}

			if( ref.kind === 'list' ) {
				const callee = expr.callee as Extract< Expr, { kind: 'field' } >
				const list = this.expr( callee.target, ctx )
				const list_type = this.of( callee.target )
				const type = this.of( expr )
				const fn = this.method( ctx, expr.args[0] )
				const item = ( type as { item: Type } ).item

				const value_of = ( index: number, target: Type )=> {
					const value = this.coerce( ctx, this.expr( expr.args[ index ], ctx ), this.of( expr.args[ index ] ), target )
					return value
				}

				switch( ref.op ) {
					case 'map':
						push( `wire_val ${ out } = wire_list_map( ${ this.type( type ) }, ${ list }, ${ fn.owner }, ${ fn.descriptor } );` )
						break
					case 'sort':
						push( `wire_val ${ out } = wire_list_sort( ${ this.type( type ) }, ${ list }, ${ fn.owner }, ${ fn.descriptor } );` )
						break
					case 'find': {
						const key = value_of( 1, fn.value )
						push( `wire_val ${ out } = wire_list_find( ${ this.type( type ) }, ${ list }, ${ fn.owner }, ${ fn.descriptor }, ${ key } );` )
						this.release( ctx, key, fn.value )
						break
					}
					case 'drop': {
						const key = value_of( 1, fn.value )
						push( `wire_val ${ out } = wire_list_drop( ${ this.type( type ) }, ${ list }, ${ fn.owner }, ${ fn.descriptor }, ${ key } );` )
						this.release( ctx, key, fn.value )
						break
					}
					case 'upsert': {
						const key = value_of( 1, fn.value )
						const value = value_of( 2, item )
						push( `wire_val ${ out } = wire_list_upsert( ${ this.type( type ) }, ${ list }, ${ fn.owner }, ${ fn.descriptor }, ${ key }, ${ value } );` )
						this.release( ctx, key, fn.value )
						this.release( ctx, value, item )
						break
					}
				}

				this.release( ctx, list, list_type )
				return out
			}

			const invoke = ref as Extract< $bog_wire_check_ref, { kind: 'invoke' } >
			const { decl, member } = this.member( invoke.owner, invoke.member )
			const owner = this.target( ctx, expr.callee )
			const name = `${ this.c( decl.name ) }__${ member.name }`
			const params = ( member as Exclude< Member, { kind: 'abstract' } > ).params.map( param => this.check.type( param.type ) )

			if( invoke.mode === 'action' ) {
				const args = this.args( ctx, expr.args, params )
				push( `A_${ name }( ${ owner }, ${ args.array } );` )
				this.release_args( ctx, args )
				return ''
			}

			const keys = this.check.keys( member ).length
			const args = this.args( ctx, expr.args.slice( 0, keys ), params.slice( 0, keys ) )

			if( invoke.mode === 'read' ) {
				push( `wire_val ${ out } = wire_read( ${ owner }, &M_${ name }, ${ args.array }, NULL );` )
				this.release_args( ctx, args )
				return out
			}

			const next_type = params[ keys ]
			const next = this.coerce( ctx, this.expr( expr.args[ keys ], ctx ), this.of( expr.args[ keys ] ), next_type )
			push( `wire_val ${ out } = wire_read( ${ owner }, &M_${ name }, ${ args.array }, &${ next } );` )
			this.release_args( ctx, args )
			this.release( ctx, next, next_type )
			return out
		}

		make( expr: Extract< Expr, { kind: 'make' } >, ctx: Ctx, out: string ): string {
			const decl = this.decl( expr.type )
			const push = ( line: string )=> ctx.lines.push( line )

			if( decl.kind === 'record' ) {
				const values = decl.fields.map( field => {
					const entry = expr.entries.find( entry => entry.name === field.name )!
					const value = this.expr( entry.value!, ctx )
					return this.coerce( ctx, value, this.of( entry.value! ), this.check.type( field.type ) )
				} )
				const fields = this.temp()
				push( `wire_val ${ fields }[] = { ${ values.join( ', ' ) } };` )
				push( `wire_val ${ out } = wire_record_new( ${ this.type({ kind: 'record', name: decl.name }) }, ${ fields } );` )
				return out
			}

			const obj = this.temp()
			push( `wire_obj* ${ obj } = wire_obj_new( &C_${ this.c( decl.name ) }, false );` )

			if( expr.entries.length ) {
				const params = [ ... ctx.params.values() ]
				let types = 'NULL'
				let values = 'NULL'
				if( params.length ) {
					types = `CT_${ this.sites + 1 }`
					values = this.temp()
					this.descriptors.push( `static const wire_type* const ${ types }[] = { ${ params.map( param => this.type( param.type ) ).join( ', ' ) } };` )
					push( `wire_val ${ values }[] = { ${ params.map( param => param.c ).join( ', ' ) } };` )
				}
				push( `wire_obj_capture( ${ obj }, self, ${ params.length }, ${ types }, ${ values } );` )

				for( const entry of expr.entries ) {
					const member = decl.members.find( member => member.name === entry.name )!
					const site = this.site( ctx, entry.value!, this.check.value_type( decl, member ) )
					push( `${ obj }->binds[ ${ this.binds.get( member ) } ] = ${ site };` )
				}
			}

			push( `wire_val ${ out } = { .obj = ${ obj } };` )
			return out
		}

		site( outer: Ctx, value: Expr, type: Type ) {
			const name = `S_${ ++this.sites }`
			const ctx: Ctx = { lines: [], params: new Map, owner: outer.owner }

			let index = 0
			for( const [ param, info ] of outer.params ) {
				ctx.params.set( param, { c: `cap[ ${ index++ } ]`, type: info.type } )
			}

			const result = this.coerce( ctx, this.expr( value, ctx ), this.of( value ), type )
			ctx.lines.push( `*out = ${ result };` )

			this.protos.push( `static void ${ name }( wire_obj* child, wire_val* out );` )
			this.bodies.push( [
				`static void ${ name }( wire_obj* child, wire_val* out ) {`,
				`\twire_obj* self = child->bind_owner;`,
				`\tconst wire_val* cap = child->captured;`,
				`\t( void ) self; ( void ) cap;`,
				... ctx.lines.map( line => '\t' + line ),
				`}`,
			].join( '\n' ) )

			return name
		}

		binary( expr: Extract< Expr, { kind: 'binary' } >, ctx: Ctx, out: string ): string {
			const push = ( line: string )=> ctx.lines.push( line )
			const type = this.of( expr )
			const left_type = this.of( expr.left )

			if( expr.op === '??' ) {
				const left = this.expr( expr.left, ctx )
				push( `wire_val ${ out };` )
				push( `if( ${ left }.box ) {` )
				ctx.lines.push( ... this.block( ctx, ()=> {
					if( type.kind === 'maybe' ) {
						push( `${ out } = ${ left };` )
						this.retain( ctx, out, type )
					} else {
						push( `${ out } = ( ( wire_some* ) ${ left }.box )->value;` )
						this.retain( ctx, out, type )
					}
				} ) )
				push( `} else {` )
				ctx.lines.push( ... this.block( ctx, ()=> {
					const right = this.expr( expr.right, ctx )
					push( `${ out } = ${ this.coerce( ctx, right, this.of( expr.right ), type ) };` )
				} ) )
				push( `}` )
				this.release( ctx, left, left_type )
				return out
			}

			const left = this.expr( expr.left, ctx )
			const right = this.expr( expr.right, ctx )
			const right_type = this.of( expr.right )
			const field = left_type.kind === 'float' ? 'f' : left_type.kind === 'bool' ? 'b' : 'i'

			switch( expr.op ) {

				case '+': case '-': case '*': case '/': case '%':
					if( left_type.kind === 'text' ) {
						push( `wire_val ${ out } = wire_text_cat( ${ left }, ${ right } );` )
					} else if( expr.op === '%' && field === 'f' ) {
						push( `wire_val ${ out } = { .f = fmod( ${ left }.f, ${ right }.f ) };` )
					} else {
						push( `wire_val ${ out } = { .${ field } = ${ left }.${ field } ${ expr.op } ${ right }.${ field } };` )
					}
					break

				case '<': case '<=': case '>': case '>=':
					if( left_type.kind === 'text' ) push( `wire_val ${ out } = { .b = wire_text_cmp( ${ left }, ${ right } ) ${ expr.op } 0 };` )
					else push( `wire_val ${ out } = { .b = ${ left }.${ field } ${ expr.op } ${ right }.${ field } };` )
					break

				case '==': case '!=': {
					const united = this.unite( left_type, right_type )
					const a = this.coerce( ctx, left, left_type, united )
					const b = this.coerce( ctx, right, right_type, united )
					push( `wire_val ${ out } = { .b = ${ expr.op === '!=' ? '!' : '' }wire_eq( ${ this.type( united ) }, ${ a }, ${ b } ) };` )
					this.release( ctx, a, united )
					this.release( ctx, b, united )
					return out
				}

				case '&&': case '||':
					push( `wire_val ${ out } = { .b = ${ left }.b ${ expr.op } ${ right }.b };` )
					break

			}

			this.release( ctx, left, left_type )
			this.release( ctx, right, right_type )
			return out
		}

		program( mode: 'test' | 'native' = 'test' ) {
			const objects = [ ... this.check.decls.values() ].filter( decl => decl.kind === 'object' ) as Owner[]
			const classes = [] as string[]

			for( const owner of objects ) {
				const { atoms, maps, binds } = this.members( owner )
				classes.push( `static const wire_class C_${ this.c( owner.name ) } = { ${ cstr( owner.name ) }, ${ atoms }, ${ maps }, ${ binds } };` )
			}

			for( const owner of objects ) {
				for( const member of owner.members ) {
					if( member.kind !== 'action' ) this.descriptor( owner, member )
				}
			}

			for( const owner of objects ) {
				for( const member of owner.members ) {
					if( member.kind === 'action' ) this.action( owner, member )
					else this.memo( owner, member )
				}
			}

			const tests = [] as string[]
			const mains = [] as string[]

			for( const module of this.check.modules ) {
				const test = /\.test\.wire$/.test( module.uri )
				const native = /\.native\.wire$/.test( module.uri )
				for( const decl of module.decls ) {
					if( decl.kind !== 'object' ) continue
					for( const member of decl.members ) {
						if( member.kind !== 'action' || member.params.length ) continue
						const name = `${ this.c( decl.name ) }__${ member.name }`
						if( test ) tests.push( `\tfailed += wire_test( ${ cstr( `${ decl.name }.${ member.name }` ) }, &C_${ this.c( decl.name ) }, A_${ name } );` )
						if( native && member.name === 'main' ) mains.push( `\treturn wire_main( &C_${ this.c( decl.name ) }, A_${ name } );` )
					}
				}
			}

			if( mode === 'native' && mains.length > 1 ) $mol_fail( new Error( 'wire: more than one action main in .native.wire' ) )

			let main = [] as string[]
			if( mode === 'test' && tests.length ) main = [ 'int main( void ) {', '\tint failed = 0;', ... tests, '\treturn failed ? 1 : 0;', '}' ]
			if( mode === 'native' && mains.length ) main = [ 'int main( void ) {', mains[0], '}' ]

			return [
				'#include "rt.h"',
				'#include <math.h>',
				'',
				... this.type_decls,
				... this.type_defs,
				'',
				... classes,
				'',
				... this.protos,
				'',
				... this.descriptors,
				'',
				... this.bodies.flatMap( body => [ body, '' ] ),
				... main,
				'',
			].join( '\n' )
		}

	}

}
