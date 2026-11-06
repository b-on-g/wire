namespace $ {

	export type $bog_wire_check_type =
		| { kind: 'int' | 'float' | 'bool' | 'text' | 'none' | 'void' | 'never' | 'error' }
		| { kind: 'list' | 'maybe', item: $bog_wire_check_type }
		| { kind: 'record' | 'object', name: string }
		| { kind: 'method', owner: string, member: string }

	export type $bog_wire_check_ref =
		| { kind: 'param', name: string }
		| { kind: 'member', owner: string, member: string }
		| { kind: 'field', record: string, index: number }
		| { kind: 'list', op: string }
		| { kind: 'assert' | 'print' }
		| { kind: 'after', owner: string, member: string }
		| { kind: 'invoke', owner: string, member: string, mode: 'read' | 'write' | 'action' }

	export type $bog_wire_check_scope = {
		owner: Extract< $bog_wire_ast_decl, { kind: 'object' } >
		params: Map< string, $bog_wire_check_type >
		action: boolean
	}

	type Type = $bog_wire_check_type
	type Ref = $bog_wire_check_ref
	type Expr = $bog_wire_ast_expr
	type Member = $bog_wire_ast_member
	type Owner = Extract< $bog_wire_ast_decl, { kind: 'object' } >
	type Shape = Extract< $bog_wire_ast_decl, { kind: 'record' } >

	type Scope = $bog_wire_check_scope

	const int = { kind: 'int' } as const
	const float = { kind: 'float' } as const
	const bool = { kind: 'bool' } as const
	const text = { kind: 'text' } as const
	const none = { kind: 'none' } as const
	const vain = { kind: 'void' } as const
	const never = { kind: 'never' } as const
	const error = { kind: 'error' } as const

	const list = ( item: Type ): Type => ({ kind: 'list', item })
	const maybe = ( item: Type ): Type => item.kind === 'maybe' || item.kind === 'none' || item.kind === 'error' ? item : { kind: 'maybe', item }

	function show( type: Type ): string {
		switch( type.kind ) {
			case 'list': return `list ${ show( type.item ) }`
			case 'maybe': return `${ show( type.item ) }?`
			case 'record': return type.name
			case 'object': return type.name
			case 'method': return `${ type.owner }.${ type.member }`
			default: return type.kind
		}
	}

	function same( left: Type, right: Type ): boolean {
		if( left.kind !== right.kind ) return false
		if( 'item' in left ) return same( left.item, ( right as typeof left ).item )
		if( 'name' in left ) return left.name === ( right as typeof left ).name
		if( 'member' in left ) return left.owner === ( right as typeof left ).owner && left.member === ( right as typeof left ).member
		return true
	}

	function fits( value: Type, target: Type ): boolean {
		if( value.kind === 'error' || target.kind === 'error' || value.kind === 'never' ) return true
		if( same( value, target ) ) return true
		if( target.kind === 'maybe' ) {
			if( value.kind === 'none' ) return true
			if( value.kind === 'maybe' ) return fits( value.item, target.item )
			return fits( value, target.item )
		}
		if( target.kind === 'list' && value.kind === 'list' ) return fits( value.item, target.item )
		return false
	}

	function unite( left: Type, right: Type ): Type | null {
		if( fits( left, right ) ) return right
		if( fits( right, left ) ) return left
		if( left.kind === 'none' ) return maybe( right )
		if( right.kind === 'none' ) return maybe( left )
		return null
	}

	const prims = new Set([ 'int', 'float', 'bool', 'text' ])

	const builtins = new Set([ 'assert', 'print', 'after' ])

	export class $bog_wire_check {

		errors = [] as $mol_error_syntax[]

		decls = new Map< string, $bog_wire_ast_decl >()

		effects = new Set< Expr >()

		value_types = new Map< Member, Type >()

		body_types = new Map< Member, Type >()

		inferring = new Set< Member >()

		types = new Map< Expr, Type >()

		refs = new Map< Expr, Ref >()

		scopes = new Map< Member, Scope >()

		constructor( readonly modules: $bog_wire_ast_module[] ) {

			for( const module of modules ) {
				for( const decl of module.decls ) {
					if( this.decls.has( decl.name ) ) this.fail( decl.span, `${ decl.name } is already declared` )
					else this.decls.set( decl.name, decl )
				}
			}

			for( const decl of this.decls.values() ) {
				if( decl.kind === 'record' ) this.record( decl )
				else this.object( decl )
			}

		}

		reported = new Set< string >()

		fail( span: $mol_span, reason: string ) {
			const key = `${ span } ${ reason }`
			if( this.reported.has( key ) ) return error
			this.reported.add( key )
			this.errors.push( new $mol_error_syntax( reason, span.source.split( '\n' )[ span.row - 1 ] ?? '', span ) )
			return error
		}

		type( type: $bog_wire_ast_type ): Type {
			switch( type.kind ) {
				case 'prim': return { kind: type.name }
				case 'list': return list( this.type( type.item ) )
				case 'maybe': return maybe( this.type( type.item ) )
				case 'ref': {
					const decl = this.decls.get( type.name )
					if( !decl ) return this.fail( type.span, `Unknown ${ type.name }` )
					return { kind: decl.kind, name: decl.name }
				}
			}
		}

		record( decl: Shape ) {
			const names = new Set< string >()
			for( const field of decl.fields ) {
				if( names.has( field.name ) ) this.fail( field.span, `Field ${ field.name } is already declared` )
				names.add( field.name )
				this.type( field.type )
			}
		}

		object( decl: Owner ) {
			const names = new Set< string >()

			for( const member of decl.members ) {
				if( names.has( member.name ) ) this.fail( member.span, `${ member.name } is already declared` )
				names.add( member.name )

				if( member.kind === 'abstract' ) {
					this.type( member.type )
					continue
				}

				const scope = this.scope( decl, member )

				if( member.kind === 'action' ) {
					for( const statement of member.body ) {
						this.expr( statement, scope )
						if( !this.effects.has( statement ) ) this.fail( statement.span, 'Statement must write state, call action or assert' )
					}
					continue
				}

				const value = this.value_type( decl, member )
				const body = this.body_type( decl, member )
				if( !fits( body, value ) ) this.fail( member.body.span, `Expected ${ show( value ) }, got ${ show( body ) }` )
			}
		}

		scope( owner: Owner, member: Exclude< Member, { kind: 'abstract' } > ): Scope {
			const params = new Map< string, Type >()

			for( const param of member.params ) {
				if( params.has( param.name ) ) this.fail( param.span, `Param ${ param.name } is already declared` )
				const type = this.type( param.type )
				params.set( param.name, param.next ? maybe( type ) : type )
			}

			const scope = { owner, params, action: member.kind === 'action' }
			this.scopes.set( member, scope )
			return scope
		}

		member( owner: Owner, name: string ) {
			return owner.members.find( member => member.name === name ) ?? null
		}

		keys( member: Member ) {
			return member.kind === 'abstract' ? [] : member.params.filter( param => !param.next )
		}

		next( member: Member ) {
			return member.kind === 'memo' ? member.params.find( param => param.next ) ?? null : null
		}

		value_type( owner: Owner, member: Member ): Type {
			const cached = this.value_types.get( member )
			if( cached ) return cached

			let type: Type
			if( member.kind === 'abstract' ) type = this.type( member.type )
			else if( member.kind === 'action' ) type = vain
			else if( member.type ) type = this.type( member.type )
			else type = this.body_type( owner, member )

			this.value_types.set( member, type )
			return type
		}

		body_type( owner: Owner, member: Extract< Member, { kind: 'memo' } > ): Type {
			const cached = this.body_types.get( member )
			if( cached ) return cached

			if( this.inferring.has( member ) ) {
				return this.fail( member.span, `Can't infer type of ${ member.name }, declare it` )
			}

			this.inferring.add( member )
			const type = this.expr( member.body, this.scope( owner, member ) )
			this.inferring.delete( member )

			this.body_types.set( member, type )
			return type
		}

		read( owner: Owner, member: Member, span: $mol_span ): Type {
			if( member.kind === 'action' ) return this.fail( span, `Action ${ member.name } can't be read` )
			if( this.keys( member ).length ) return { kind: 'method', owner: owner.name, member: member.name }
			return this.value_type( owner, member )
		}

		expr( expr: Expr, scope: Scope ): Type {
			const type = this.infer( expr, scope )
			this.types.set( expr, type )
			return type
		}

		infer( expr: Expr, scope: Scope ): Type {
			switch( expr.kind ) {

				case 'number': return expr.float ? float : int
				case 'bool': return bool
				case 'none': return none

				case 'text': {
					for( const part of expr.parts ) {
						if( typeof part === 'string' ) continue
						const type = this.expr( part, scope )
						if( type.kind !== 'error' && !prims.has( type.kind ) ) this.fail( part.span, `Can't put ${ show( type ) } into text` )
					}
					return text
				}

				case 'name': {
					if( expr.name.startsWith( '$' ) ) return this.fail( expr.span, `Expected ${ expr.name }() or ${ expr.name }{ … }` )
					const param = scope.params.get( expr.name )
					if( param ) {
						this.refs.set( expr, { kind: 'param', name: expr.name } )
						return param
					}
					const member = this.member( scope.owner, expr.name )
					if( !member ) return this.fail( expr.span, `Unknown ${ expr.name }` )
					this.refs.set( expr, { kind: 'member', owner: scope.owner.name, member: member.name } )
					return this.read( scope.owner, member, expr.span )
				}

				case 'list': {
					let item: Type = never
					for( const entry of expr.items ) {
						let type: Type
						if( entry.kind === 'spread' ) {
							const spread = this.expr( entry.value, scope )
							if( spread.kind === 'error' ) continue
							if( spread.kind !== 'list' ) {
								this.fail( entry.span, `Can't spread ${ show( spread ) }` )
								continue
							}
							type = spread.item
						} else {
							type = this.expr( entry, scope )
						}
						const united = unite( item, type )
						if( !united ) this.fail( entry.span, `Expected ${ show( item ) }, got ${ show( type ) }` )
						else item = united
					}
					return list( item )
				}

				case 'spread': return this.fail( expr.span, 'Spread is allowed only in list' )

				case 'unary': {
					const value = this.expr( expr.value, scope )
					if( value.kind === 'error' ) return error
					if( expr.op === '!' ) {
						if( value.kind !== 'bool' ) return this.fail( expr.span, `Expected bool, got ${ show( value ) }` )
						return bool
					}
					if( value.kind !== 'int' && value.kind !== 'float' ) return this.fail( expr.span, `Expected number, got ${ show( value ) }` )
					return value
				}

				case 'binary': return this.binary( expr, scope )

				case 'cond': {
					const test = this.expr( expr.test, scope )
					if( !fits( test, bool ) ) this.fail( expr.test.span, `Expected bool, got ${ show( test ) }` )
					const then = this.expr( expr.then, scope )
					const other = this.expr( expr.else, scope )
					return unite( then, other ) ?? this.fail( expr.span, `Branches differ: ${ show( then ) } and ${ show( other ) }` )
				}

				case 'field': return this.field( expr, scope )

				case 'call': return this.call( expr, scope )

				case 'make': return this.make( expr, scope )

			}
		}

		binary( expr: Extract< Expr, { kind: 'binary' } >, scope: Scope ): Type {
			const left = this.expr( expr.left, scope )
			const right = this.expr( expr.right, scope )
			if( left.kind === 'error' || right.kind === 'error' ) return error

			const mismatch = ()=> this.fail( expr.span, `Can't apply ${ expr.op } to ${ show( left ) } and ${ show( right ) }` )

			switch( expr.op ) {

				case '+': case '-': case '*': case '/': case '%':
					if( ( left.kind === 'int' || left.kind === 'float' ) && same( left, right ) ) return left
					if( expr.op === '+' && left.kind === 'text' && right.kind === 'text' ) return text
					return mismatch()

				case '==': case '!=':
					if( !unite( left, right ) ) return mismatch()
					return bool

				case '<': case '<=': case '>': case '>=':
					if( !same( left, right ) || ![ 'int', 'float', 'text' ].includes( left.kind ) ) return mismatch()
					return bool

				case '&&': case '||':
					if( left.kind !== 'bool' || right.kind !== 'bool' ) return mismatch()
					return bool

				case '??': {
					if( left.kind === 'none' ) return right
					if( left.kind !== 'maybe' ) return this.fail( expr.left.span, `${ show( left ) } is never none` )
					const united = unite( left.item, right )
					return united ?? mismatch()
				}

			}

			return mismatch()
		}

		field( expr: Extract< Expr, { kind: 'field' } >, scope: Scope ): Type {
			let target = this.expr( expr.target, scope )
			if( target.kind === 'error' ) return error

			if( expr.maybe ) {
				if( target.kind !== 'maybe' ) return this.fail( expr.span, `${ show( target ) } is never none, use .` )
				const type = this.access( target.item, expr )
				return type.kind === 'method' ? this.fail( expr.span, `Can't take method ${ expr.name } through ?.` ) : maybe( type )
			}

			if( target.kind === 'maybe' ) return this.fail( expr.span, `${ show( target ) } may be none, use ?.` )
			return this.access( target, expr )
		}

		access( target: Type, expr: Extract< Expr, { kind: 'field' } > ): Type {

			if( target.kind === 'object' ) {
				const owner = this.decls.get( target.name ) as Owner
				const member = this.member( owner, expr.name )
				if( !member ) return this.fail( expr.span, `${ target.name } has no ${ expr.name }` )
				this.refs.set( expr, { kind: 'member', owner: owner.name, member: member.name } )
				return this.read( owner, member, expr.span )
			}

			if( target.kind === 'record' ) {
				const record = this.decls.get( target.name ) as Shape
				const index = record.fields.findIndex( field => field.name === expr.name )
				if( index < 0 ) return this.fail( expr.span, `${ target.name } has no ${ expr.name }` )
				this.refs.set( expr, { kind: 'field', record: record.name, index } )
				return this.type( record.fields[ index ].type )
			}

			if( target.kind === 'list' ) {
				if( expr.name === 'sum' || expr.name === 'size' ) this.refs.set( expr, { kind: 'list', op: expr.name } )
				if( expr.name === 'sum' ) {
					if( target.item.kind === 'never' ) return int
					if( target.item.kind !== 'int' && target.item.kind !== 'float' ) return this.fail( expr.span, `Can't sum ${ show( target ) }` )
					return target.item
				}
				if( expr.name === 'size' ) return int
				return this.fail( expr.span, `List has no ${ expr.name }` )
			}

			return this.fail( expr.span, `${ show( target ) } has no ${ expr.name }` )
		}

		args( params: $bog_wire_ast_param[], args: Expr[], scope: Scope ) {
			params.forEach( ( param, index ) => {
				const type = this.expr( args[ index ], scope )
				const expected = this.type( param.type )
				if( !fits( type, expected ) ) this.fail( args[ index ].span, `Expected ${ show( expected ) }, got ${ show( type ) }` )
			} )
		}

		call( expr: Extract< Expr, { kind: 'call' } >, scope: Scope ): Type {
			const callee = expr.callee

			const builtin = callee.kind === 'name' && builtins.has( callee.name ) && !scope.params.has( callee.name ) && !this.member( scope.owner, callee.name )

			if( builtin && callee.name === 'after' ) {
				if( !scope.action ) return this.fail( expr.span, 'after is allowed only in action' )
				this.effects.add( expr )
				if( expr.args.length !== 1 ) return this.fail( expr.span, 'after takes one action' )
				const task = this.task( expr.args[0], scope )
				if( !task ) return error
				this.refs.set( expr, { kind: 'after', ... task } )
				return vain
			}

			if( builtin ) {
				const expected = callee.name === 'assert' ? bool : text
				if( !scope.action ) return this.fail( expr.span, `${ callee.name } is allowed only in action` )
				if( expr.args.length !== 1 ) return this.fail( expr.span, `${ callee.name } takes one ${ show( expected ) }` )
				const type = this.expr( expr.args[0], scope )
				if( !fits( type, expected ) ) this.fail( expr.args[0].span, `Expected ${ show( expected ) }, got ${ show( type ) }` )
				this.refs.set( expr, { kind: callee.name as 'assert' | 'print' } )
				this.effects.add( expr )
				return vain
			}

			if( callee.kind === 'name' && !scope.params.has( callee.name ) ) {
				const member = this.member( scope.owner, callee.name )
				if( !member ) return this.fail( callee.span, `Unknown ${ callee.name }` )
				return this.invoke( scope.owner, member, expr, scope )
			}

			if( callee.kind === 'field' && !callee.maybe ) {
				const target = this.expr( callee.target, scope )
				if( target.kind === 'error' ) return error
				if( target.kind === 'list' ) return this.list_call( target, callee.name, expr, scope )
				if( target.kind === 'object' ) {
					const owner = this.decls.get( target.name ) as Owner
					const member = this.member( owner, callee.name )
					if( !member ) return this.fail( callee.span, `${ target.name } has no ${ callee.name }` )
					return this.invoke( owner, member, expr, scope )
				}
				if( target.kind === 'maybe' ) return this.fail( callee.span, `${ show( target ) } may be none` )
				return this.fail( callee.span, `${ show( target ) } has no ${ callee.name }` )
			}

			return this.fail( expr.span, 'Not callable' )
		}

		task( arg: Expr, scope: Scope ) {
			let owner: Owner | null = null
			let name = ''

			if( arg.kind === 'name' && !scope.params.has( arg.name ) ) {
				owner = scope.owner
				name = arg.name
			} else if( arg.kind === 'field' && !arg.maybe ) {
				const target = this.expr( arg.target, scope )
				if( target.kind === 'error' ) return null
				if( target.kind !== 'object' ) {
					this.fail( arg.span, `Expected action, got ${ show( target ) }.${ arg.name }` )
					return null
				}
				owner = this.decls.get( target.name ) as Owner
				name = arg.name
			} else {
				this.fail( arg.span, 'Expected action' )
				return null
			}

			const member = this.member( owner, name )
			if( !member || member.kind !== 'action' ) {
				this.fail( arg.span, `${ name } is not an action` )
				return null
			}
			if( member.params.length ) {
				this.fail( arg.span, `Action ${ name } for after must take no params` )
				return null
			}

			return { owner: owner.name, member: name }
		}

		invoke( owner: Owner, member: Member, expr: Extract< Expr, { kind: 'call' } >, scope: Scope ): Type {
			if( member.kind === 'abstract' ) return this.fail( expr.span, `${ member.name } is not callable` )

			if( member.kind === 'action' ) {
				if( !scope.action ) return this.fail( expr.span, `Action ${ member.name } can't be called from memo` )
				if( expr.args.length !== member.params.length ) return this.fail( expr.span, `${ member.name } takes ${ member.params.length } args` )
				this.args( member.params, expr.args, scope )
				this.refs.set( expr, { kind: 'invoke', owner: owner.name, member: member.name, mode: 'action' } )
				this.effects.add( expr )
				return vain
			}

			const keys = this.keys( member )
			const next = this.next( member )

			if( expr.args.length === keys.length ) {
				this.args( keys, expr.args, scope )
				this.refs.set( expr, { kind: 'invoke', owner: owner.name, member: member.name, mode: 'read' } )
				return this.value_type( owner, member )
			}

			if( next && expr.args.length === keys.length + 1 ) {
				if( !scope.action ) return this.fail( expr.span, `Write to ${ member.name } is allowed only in action` )
				this.args( member.params, expr.args, scope )
				this.refs.set( expr, { kind: 'invoke', owner: owner.name, member: member.name, mode: 'write' } )
				this.effects.add( expr )
				return this.value_type( owner, member )
			}

			return this.fail( expr.span, `${ member.name } takes ${ keys.length } args${ next ? ` or ${ keys.length + 1 } to write` : '' }` )
		}

		method( arg: Expr | undefined, item: Type, scope: Scope, span: $mol_span ): Type {
			if( !arg ) return this.fail( span, 'Expected method' )

			const ref = this.expr( arg, scope )
			if( ref.kind === 'error' ) return error
			if( ref.kind !== 'method' ) return this.fail( arg.span, `Expected method, got ${ show( ref ) }` )

			const owner = this.decls.get( ref.owner ) as Owner
			const member = this.member( owner, ref.member )!
			const keys = this.keys( member )
			if( keys.length !== 1 ) return this.fail( arg.span, `${ ref.member } must take one key` )

			const key = this.type( keys[0].type )
			if( !fits( item, key ) ) return this.fail( arg.span, `${ ref.member } takes ${ show( key ) }, list has ${ show( item ) }` )

			return this.value_type( owner, member )
		}

		list_call( target: { kind: 'list' | 'maybe', item: Type }, name: string, expr: Extract< Expr, { kind: 'call' } >, scope: Scope ): Type {
			const arity: Record_< number > = { map: 1, sort: 1, find: 2, drop: 2, upsert: 3, join: 1 }
			if( !Object.hasOwn( arity, name ) ) return this.fail( expr.callee.span, `List has no ${ name }` )
			if( expr.args.length !== arity[ name ] ) return this.fail( expr.span, `${ name } takes ${ arity[ name ] } args` )

			if( name === 'join' ) {
				if( !fits( target.item, text ) ) return this.fail( expr.callee.span, `Can't join ${ show( target ) }` )
				const separator = this.expr( expr.args[0], scope )
				if( !fits( separator, text ) ) return this.fail( expr.args[0].span, `Expected text, got ${ show( separator ) }` )
				this.refs.set( expr, { kind: 'list', op: name } )
				return text
			}

			const result = this.method( expr.args[0], target.item, scope, expr.span )
			if( result.kind === 'error' ) return error
			this.refs.set( expr, { kind: 'list', op: name } )

			const key = ( index: number )=> {
				const type = this.expr( expr.args[ index ], scope )
				if( !fits( type, result ) ) this.fail( expr.args[ index ].span, `Expected ${ show( result ) }, got ${ show( type ) }` )
			}

			switch( name ) {

				case 'map': return list( result )

				case 'sort':
					if( ![ 'int', 'float', 'text' ].includes( result.kind ) ) return this.fail( expr.args[0].span, `Can't sort by ${ show( result ) }` )
					return target

				case 'find':
					key( 1 )
					return maybe( target.item )

				case 'drop':
					key( 1 )
					return target

				case 'upsert': {
					key( 1 )
					const value = this.expr( expr.args[2], scope )
					if( !fits( value, target.item ) ) this.fail( expr.args[2].span, `Expected ${ show( target.item ) }, got ${ show( value ) }` )
					return target
				}

			}

			return error
		}

		make( expr: Extract< Expr, { kind: 'make' } >, scope: Scope ): Type {
			const decl = this.decls.get( expr.type )
			if( !decl ) return this.fail( expr.span, `Unknown ${ expr.type }` )

			const seen = new Set< string >()

			for( const entry of expr.entries ) {
				if( seen.has( entry.name ) ) this.fail( entry.span, `${ entry.name } is set twice` )
				seen.add( entry.name )
			}

			if( decl.kind === 'record' ) {

				for( const entry of expr.entries ) {
					if( entry.kind === 'bind' ) {
						this.fail( entry.span, `Record ${ decl.name } takes fields, not binds` )
						continue
					}
					const field = decl.fields.find( field => field.name === entry.name )
					if( !field ) {
						this.fail( entry.span, `${ decl.name } has no ${ entry.name }` )
						continue
					}
					const value = entry.value ??= { kind: 'name' as const, name: entry.name, span: entry.span }
					const type = this.expr( value, scope )
					const expected = this.type( field.type )
					if( !fits( type, expected ) ) this.fail( entry.span, `Expected ${ show( expected ) }, got ${ show( type ) }` )
				}

				for( const field of decl.fields ) {
					if( !seen.has( field.name ) ) this.fail( expr.span, `Field ${ field.name } is not set` )
				}

				return { kind: 'record', name: decl.name }
			}

			for( const entry of expr.entries ) {
				if( entry.kind !== 'bind' ) {
					this.fail( entry.span, `Owner ${ decl.name } takes binds <=, not fields` )
					continue
				}
				const member = this.member( decl, entry.name )
				if( !member || member.kind !== 'abstract' ) {
					this.fail( entry.span, `${ decl.name } has no property ${ entry.name } to bind` )
					continue
				}
				const type = this.expr( entry.value!, scope )
				const expected = this.type( member.type )
				if( !fits( type, expected ) ) this.fail( entry.span, `Expected ${ show( expected ) }, got ${ show( type ) }` )
			}

			for( const member of decl.members ) {
				if( member.kind === 'abstract' && !seen.has( member.name ) ) this.fail( expr.span, `Property ${ member.name } is not bound` )
			}

			return { kind: 'object', name: decl.name }
		}

	}

	type Record_< Value > = { [ key: string ]: Value }

}
