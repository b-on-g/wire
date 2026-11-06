namespace $ {

	const keywords = new Set([ 'type', 'object', 'action', 'solid', 'true', 'false', 'none' ])

	const prims = new Set([ 'int', 'float', 'bool', 'text' ])

	const levels = [
		[ '??' ],
		[ '||' ],
		[ '&&' ],
		[ '==', '!=' ],
		[ '<', '<=', '>', '>=' ],
		[ '+', '-' ],
		[ '*', '/', '%' ],
	]

	const escapes: Record< string, string > = { n: '\n', t: '\t', '"': '"', '\\': '\\', '{': '{', '}': '}' }

	class Parser {

		pos = 0

		constructor(
			readonly tokens: $bog_wire_lex_token[],
			readonly lines: string[],
		) {}

		peek( offset = 0 ) {
			return this.tokens[ Math.min( this.pos + offset, this.tokens.length - 1 ) ]
		}

		is( text: string, offset = 0 ) {
			const token = this.peek( offset )
			return ( token.kind === 'punct' || token.kind === 'name' ) && token.text === text
		}

		next() {
			const token = this.peek()
			if( token.kind !== 'end' ) this.pos += 1
			return token
		}

		fail( token: $bog_wire_lex_token, reason: string ): never {
			return $mol_fail( new $mol_error_syntax( reason, this.lines[ token.span.row - 1 ] ?? '', token.span ) )
		}

		expect( text: string ) {
			if( !this.is( text ) ) this.fail( this.peek(), `Expected ${ text }` )
			return this.next()
		}

		skip( text: string ) {
			if( this.is( text ) ) this.next()
		}

		name() {
			const token = this.peek()
			if( token.kind !== 'name' || keywords.has( token.text ) ) this.fail( token, 'Expected name' )
			return this.next()
		}

		fqn() {
			const token = this.peek()
			if( token.kind !== 'fqn' ) this.fail( token, 'Expected FQN name' )
			return this.next()
		}

		module( uri: string ): $bog_wire_ast_module {
			const decls = [] as $bog_wire_ast_decl[]
			while( this.peek().kind !== 'end' ) decls.push( this.decl() )
			return { uri, decls }
		}

		decl(): $bog_wire_ast_decl {
			const start = this.peek()

			if( this.is( 'type' ) ) {
				this.next()
				const name = this.fqn().text
				const fields = [] as $bog_wire_ast_field[]
				this.expect( '{' )
				while( !this.is( '}' ) ) {
					const field = this.name()
					this.expect( ':' )
					fields.push({ name: field.text, type: this.type(), span: field.span })
					this.skip( ',' )
				}
				this.expect( '}' )
				return { kind: 'record', name, fields, span: start.span }
			}

			if( this.is( 'object' ) ) {
				this.next()
				const name = this.fqn().text
				const members = [] as $bog_wire_ast_member[]
				this.expect( '{' )
				while( !this.is( '}' ) ) members.push( this.member() )
				this.expect( '}' )
				return { kind: 'object', name, members, span: start.span }
			}

			return this.fail( start, 'Expected type or object' )
		}

		member(): $bog_wire_ast_member {
			const start = this.peek()

			if( this.is( 'action' ) ) {
				this.next()
				const name = this.name()
				const params = this.params()
				const body = [] as $bog_wire_ast_expr[]
				this.expect( '{' )
				while( !this.is( '}' ) ) body.push( this.expr() )
				this.expect( '}' )
				return { kind: 'action', name: name.text, params, body, span: name.span }
			}

			const solid = this.is( 'solid' )
			if( solid ) this.next()

			const name = this.name()
			const braced = this.is( '(' )
			const params = braced ? this.params() : []
			const type = this.is( ':' ) ? ( this.next(), this.type() ) : null

			if( this.is( '=' ) ) {
				this.next()
				return { kind: 'memo', name: name.text, solid, params, type, body: this.expr(), span: name.span }
			}

			if( solid || braced || !type ) this.fail( this.peek(), 'Expected =' )

			return { kind: 'abstract', name: name.text, type: type!, span: start.span }
		}

		params() {
			const params = [] as $bog_wire_ast_param[]
			this.expect( '(' )

			while( !this.is( ')' ) ) {
				const name = this.name()
				const next = this.is( '?' )
				if( next ) this.next()
				this.expect( ':' )
				params.push({ name: name.text, type: this.type(), next, span: name.span })
				if( !this.is( ')' ) ) this.expect( ',' )
			}

			this.expect( ')' )

			const nexts = params.filter( param => param.next )
			if( nexts.length > 1 || ( nexts.length && !params.at( -1 )!.next ) ) {
				this.fail( this.tokens.find( token => token.span === nexts[0].span )!, 'Only the last param can be next' )
			}

			return params
		}

		type(): $bog_wire_ast_type {
			const token = this.peek()
			let type: $bog_wire_ast_type

			if( token.kind === 'fqn' ) {
				this.next()
				type = { kind: 'ref', name: token.text, span: token.span }
			} else if( token.kind === 'name' && prims.has( token.text ) ) {
				this.next()
				type = { kind: 'prim', name: token.text as 'int', span: token.span }
			} else if( token.kind === 'name' && token.text === 'list' ) {
				this.next()
				type = { kind: 'list', item: this.type(), span: token.span }
			} else {
				return this.fail( token, 'Expected type' )
			}

			while( this.is( '?' ) ) {
				const mark = this.next()
				type = { kind: 'maybe', item: type, span: mark.span }
			}

			return type
		}

		expr(): $bog_wire_ast_expr {
			const test = this.binary( 0 )
			if( !this.is( '?' ) ) return test

			const mark = this.next()
			const then = this.expr()
			this.expect( ':' )
			return { kind: 'cond', test, then, else: this.expr(), span: mark.span }
		}

		binary( level: number ): $bog_wire_ast_expr {
			if( level === levels.length ) return this.unary()

			let left = this.binary( level + 1 )

			while( levels[ level ].some( op => this.peek().kind === 'punct' && this.is( op ) ) ) {
				const op = this.next()
				left = { kind: 'binary', op: op.text, left, right: this.binary( level + 1 ), span: op.span }
			}

			return left
		}

		unary(): $bog_wire_ast_expr {
			if( this.is( '-' ) || this.is( '!' ) ) {
				const op = this.next()
				return { kind: 'unary', op: op.text, value: this.unary(), span: op.span }
			}
			return this.postfix()
		}

		postfix(): $bog_wire_ast_expr {
			let value = this.primary()

			while( true ) {

				if( this.is( '(' ) ) {
					const mark = this.next()
					const args = [] as $bog_wire_ast_expr[]
					while( !this.is( ')' ) ) {
						args.push( this.expr() )
						if( !this.is( ')' ) ) this.expect( ',' )
					}
					this.expect( ')' )
					value = { kind: 'call', callee: value, args, span: mark.span }
					continue
				}

				if( this.is( '.' ) || this.is( '?.' ) ) {
					const mark = this.next()
					const name = this.peek()
					if( name.kind !== 'name' ) this.fail( name, 'Expected name' )
					this.next()
					value = { kind: 'field', target: value, name: name.text, maybe: mark.text === '?.', span: name.span }
					continue
				}

				return value
			}
		}

		primary(): $bog_wire_ast_expr {
			const token = this.peek()

			if( token.kind === 'number' ) {
				this.next()
				return { kind: 'number', value: Number( token.text ), float: token.text.includes( '.' ), span: token.span }
			}

			if( token.kind === 'text' ) {
				this.next()
				return { kind: 'text', parts: this.text( token ), span: token.span }
			}

			if( token.kind === 'name' ) {
				if( token.text === 'true' || token.text === 'false' ) {
					this.next()
					return { kind: 'bool', value: token.text === 'true', span: token.span }
				}
				if( token.text === 'none' ) {
					this.next()
					return { kind: 'none', span: token.span }
				}
				return { kind: 'name', name: this.name().text, span: token.span }
			}

			if( token.kind === 'fqn' ) {
				this.next()

				if( this.is( '(' ) ) {
					this.next()
					if( !this.is( ')' ) ) this.fail( this.peek(), 'Objects take no arguments, bind properties with <=' )
					this.next()
					return { kind: 'make', type: token.text, entries: [], span: token.span }
				}

				if( this.is( '{' ) ) {
					return { kind: 'make', type: token.text, entries: this.entries(), span: token.span }
				}

				return { kind: 'name', name: token.text, span: token.span }
			}

			if( this.is( '[' ) ) {
				this.next()
				const items = [] as $bog_wire_ast_expr[]
				while( !this.is( ']' ) ) {
					if( this.is( '...' ) ) {
						const mark = this.next()
						items.push({ kind: 'spread', value: this.expr(), span: mark.span })
					} else {
						items.push( this.expr() )
					}
					if( !this.is( ']' ) ) this.expect( ',' )
				}
				this.expect( ']' )
				return { kind: 'list', items, span: token.span }
			}

			if( this.is( '(' ) ) {
				this.next()
				const value = this.expr()
				this.expect( ')' )
				return value
			}

			return this.fail( token, 'Expected expression' )
		}

		entries() {
			const entries = [] as $bog_wire_ast_entry[]
			this.expect( '{' )

			while( !this.is( '}' ) ) {
				const name = this.name()

				if( this.is( '<=' ) ) {
					this.next()
					entries.push({ kind: 'bind', name: name.text, value: this.expr(), span: name.span })
				} else if( this.is( ':' ) ) {
					this.next()
					entries.push({ kind: 'field', name: name.text, value: this.expr(), span: name.span })
				} else {
					entries.push({ kind: 'short', name: name.text, value: null, span: name.span })
				}

				this.skip( ',' )
			}

			this.expect( '}' )
			return entries
		}

		text( token: $bog_wire_lex_token ) {
			const raw = token.text
			const parts = [] as ( string | $bog_wire_ast_expr )[]
			const at = ( index: number, length = 1 ) => ({ ...token, span: token.span.span( token.span.row, token.span.col + 1 + index, length ) })

			let chunk = ''
			let index = 0

			while( index < raw.length ) {
				const char = raw[ index ]

				if( char === '\\' ) {
					const escaped = escapes[ raw[ index + 1 ] ]
					if( escaped === undefined ) this.fail( at( index, 2 ), 'Unknown escape' )
					chunk += escaped
					index += 2
					continue
				}

				if( char === '{' ) {
					const end = raw.indexOf( '}', index )
					if( end < 0 ) this.fail( at( index ), 'Unclosed {' )
					if( chunk ) parts.push( chunk )
					chunk = ''

					const inner = raw.slice( index + 1, end )
					const origin = token.span.span( token.span.row, token.span.col + 2 + index, inner.length )
					const sub = new Parser( $bog_wire_lex( inner, origin ), this.lines )
					parts.push( sub.expr() )
					if( sub.peek().kind !== 'end' ) sub.fail( sub.peek(), 'Expected }' )

					index = end + 1
					continue
				}

				if( char === '}' ) this.fail( at( index ), 'Unescaped }' )

				chunk += char
				index += 1
			}

			if( chunk ) parts.push( chunk )
			return parts
		}

	}

	export function $bog_wire_parse( source: string, uri = '?' ) {
		const origin = $mol_span.begin( uri, source )
		const parser = new Parser( $bog_wire_lex( source, origin ), source.split( '\n' ) )
		return parser.module( uri )
	}

}
