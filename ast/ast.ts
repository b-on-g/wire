namespace $ {

	export type $bog_wire_ast_type =
		| { kind: 'prim', name: 'int' | 'float' | 'bool' | 'text', span: $mol_span }
		| { kind: 'ref', name: string, span: $mol_span }
		| { kind: 'list', item: $bog_wire_ast_type, span: $mol_span }
		| { kind: 'maybe', item: $bog_wire_ast_type, span: $mol_span }

	export type $bog_wire_ast_entry = {
		kind: 'bind' | 'field' | 'short'
		name: string
		value: $bog_wire_ast_expr | null
		span: $mol_span
	}

	export type $bog_wire_ast_expr =
		| { kind: 'number', value: number, float: boolean, span: $mol_span }
		| { kind: 'text', parts: ( string | $bog_wire_ast_expr )[], span: $mol_span }
		| { kind: 'bool', value: boolean, span: $mol_span }
		| { kind: 'none', span: $mol_span }
		| { kind: 'name', name: string, span: $mol_span }
		| { kind: 'list', items: $bog_wire_ast_expr[], span: $mol_span }
		| { kind: 'spread', value: $bog_wire_ast_expr, span: $mol_span }
		| { kind: 'make', type: string, entries: $bog_wire_ast_entry[], span: $mol_span }
		| { kind: 'call', callee: $bog_wire_ast_expr, args: $bog_wire_ast_expr[], span: $mol_span }
		| { kind: 'field', target: $bog_wire_ast_expr, name: string, maybe: boolean, span: $mol_span }
		| { kind: 'unary', op: string, value: $bog_wire_ast_expr, span: $mol_span }
		| { kind: 'binary', op: string, left: $bog_wire_ast_expr, right: $bog_wire_ast_expr, span: $mol_span }
		| { kind: 'cond', test: $bog_wire_ast_expr, then: $bog_wire_ast_expr, else: $bog_wire_ast_expr, span: $mol_span }

	export type $bog_wire_ast_param = {
		name: string
		type: $bog_wire_ast_type
		next: boolean
		span: $mol_span
	}

	export type $bog_wire_ast_member =
		| {
			kind: 'memo'
			name: string
			solid: boolean
			params: $bog_wire_ast_param[]
			type: $bog_wire_ast_type | null
			body: $bog_wire_ast_expr
			span: $mol_span
		}
		| {
			kind: 'action'
			name: string
			params: $bog_wire_ast_param[]
			body: $bog_wire_ast_expr[]
			span: $mol_span
		}
		| {
			kind: 'abstract'
			name: string
			type: $bog_wire_ast_type
			span: $mol_span
		}

	export type $bog_wire_ast_field = {
		name: string
		type: $bog_wire_ast_type
		span: $mol_span
	}

	export type $bog_wire_ast_decl =
		| { kind: 'record', name: string, fields: $bog_wire_ast_field[], span: $mol_span }
		| { kind: 'object', name: string, members: $bog_wire_ast_member[], span: $mol_span }

	export type $bog_wire_ast_module = {
		uri: string
		decls: $bog_wire_ast_decl[]
	}

}
