namespace $ {

	function type_dump( type: $bog_wire_ast_type ): string {
		switch( type.kind ) {
			case 'prim': return type.name
			case 'ref': return type.name
			case 'list': return `list ${ type_dump( type.item ) }`
			case 'maybe': return `${ type_dump( type.item ) }?`
		}
	}

	function expr_dump( expr: $bog_wire_ast_expr ): string {
		const dump = expr_dump

		switch( expr.kind ) {
			case 'number': return String( expr.value )
			case 'bool': return String( expr.value )
			case 'none': return 'none'
			case 'name': return expr.name
			case 'spread': return `...${ dump( expr.value ) }`
			case 'list': return `[${ expr.items.map( dump ).join( ' ' ) }]`
			case 'call': return `(call ${ [ expr.callee, ... expr.args ].map( dump ).join( ' ' ) })`
			case 'field': return `(${ expr.maybe ? '?.' : '.' } ${ dump( expr.target ) } ${ expr.name })`
			case 'unary': return `(${ expr.op } ${ dump( expr.value ) })`
			case 'binary': return `(${ expr.op } ${ dump( expr.left ) } ${ dump( expr.right ) })`
			case 'cond': return `(? ${ dump( expr.test ) } ${ dump( expr.then ) } ${ dump( expr.else ) })`
		}

		if( expr.kind === 'text' ) {
			const parts = expr.parts.map( part => typeof part === 'string' ? JSON.stringify( part ) : dump( part ) )
			if( parts.length === 1 && typeof expr.parts[0] === 'string' ) return parts[0]
			return `(text ${ parts.join( ' ' ) })`
		}

		const entries = expr.entries.map( entry => {
			switch( entry.kind ) {
				case 'short': return entry.name
				case 'bind': return `${ entry.name }<=${ dump( entry.value! ) }`
				case 'field': return `${ entry.name }:${ dump( entry.value! ) }`
			}
		} )

		return `(${ [ expr.type, ... entries ].join( ' ' ) })`
	}

	function params( list: $bog_wire_ast_param[] ) {
		return `(${ list.map( param => `${ param.name }${ param.next ? '?' : '' }: ${ type_dump( param.type ) }` ).join( ', ' ) })`
	}

	function member_dump( member: $bog_wire_ast_member ): string {
		const type = type_dump

		switch( member.kind ) {

			case 'abstract': return `(abstract ${ member.name } ${ type( member.type ) })`

			case 'action': return `(action ${ member.name } ${ params( member.params ) } ${ member.body.map( expr_dump ).join( ' ' ) })`

			case 'memo': {
				const head = [
					member.solid ? 'solid' : '',
					member.name,
					member.params.length ? params( member.params ) : '',
					member.type ? `: ${ type( member.type ) }` : '',
				].filter( Boolean ).join( ' ' )
				return `(memo ${ head } ${ expr_dump( member.body ) })`
			}

		}
	}

	export function $bog_wire_ast_dump( module: $bog_wire_ast_module ) {
		return module.decls.map( decl => {
			if( decl.kind === 'record' ) {
				return `(type ${ decl.name }${ decl.fields.map( field => ` (${ field.name } ${ type_dump( field.type ) })` ).join( '' ) })`
			}
			return `(object ${ decl.name }${ decl.members.map( member => '\n\t' + member_dump( member ) ).join( '' ) })`
		} ).join( '\n' )
	}

}
