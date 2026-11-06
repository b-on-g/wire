namespace $ {

	export type $bog_wire_lex_token = {
		kind: 'name' | 'fqn' | 'number' | 'text' | 'punct' | 'end'
		text: string
		span: $mol_span
	}

	const puncts = [
		'...', '?.', '??', '<=', '>=', '==', '!=', '&&', '||',
		'{', '}', '(', ')', '[', ']', ',', '.', '?', ':', '=', '<', '>', '+', '-', '*', '/', '%', '!',
	]

	export function $bog_wire_lex( source: string, origin = $mol_span.begin( '?', source ) ) {
		const tokens = [] as $bog_wire_lex_token[]
		const lines = origin.source.split( '\n' )

		let pos = 0
		let row = origin.row
		let col = origin.col

		const fail = ( reason: string, length = 1 ): never => {
			return $mol_fail( new $mol_error_syntax( reason, lines[ row - 1 ] ?? '', origin.span( row, col, length ) ) )
		}

		const push = ( kind: $bog_wire_lex_token[ 'kind' ], length: number, text = source.slice( pos, pos + length ) ) => {
			tokens.push({ kind, text, span: origin.span( row, col, length ) })
			pos += length
			col += length
		}

		const match = ( regexp: RegExp ) => regexp.exec( source.slice( pos ) )?.[ 0 ] ?? ''

		while( pos < source.length ) {
			const char = source[ pos ]

			if( char === '\n' ) {
				pos += 1
				row += 1
				col = 1
				continue
			}

			if( char === ' ' || char === '\t' || char === '\r' ) {
				pos += 1
				col += 1
				continue
			}

			if( /[a-z_]/i.test( char ) ) {
				push( 'name', match( /^[a-z_][a-z0-9_]*/i ).length )
				continue
			}

			if( char === '$' ) {
				const fqn = match( /^\$[a-z0-9_]+/i )
				if( !fqn ) fail( 'Expected name after $' )
				push( 'fqn', fqn.length )
				continue
			}

			if( /[0-9]/.test( char ) ) {
				push( 'number', match( /^[0-9]+(\.[0-9]+)?/ ).length )
				continue
			}

			if( char === '"' ) {
				let end = pos + 1
				while( end < source.length && source[ end ] !== '"' ) {
					if( source[ end ] === '\n' ) break
					end += source[ end ] === '\\' ? 2 : 1
				}
				if( source[ end ] !== '"' ) fail( 'Unclosed text', end - pos )
				push( 'text', end - pos + 1, source.slice( pos + 1, end ) )
				continue
			}

			const punct = puncts.find( punct => source.startsWith( punct, pos ) )
			if( !punct ) fail( `Unexpected ${ JSON.stringify( char ) }` )
			push( 'punct', punct!.length )
		}

		tokens.push({ kind: 'end', text: '', span: origin.span( row, col, 0 ) })

		return tokens
	}

}
