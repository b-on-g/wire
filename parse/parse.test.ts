namespace $ {

	function expr( source: string ) {
		return $bog_wire_ast_dump( $bog_wire_parse( `object $bog_wire_parse_t {\n\te = ${ source }\n}` ) ).replace( /^\(object \$bog_wire_parse_t\n\t\(memo e (.*)\)\)$/s, '$1' )
	}

	function failure( source: string ) {
		try {
			$bog_wire_parse( source )
		} catch( error: any ) {
			return `${ error.reason } ${ error.span.row }:${ error.span.col }`
		}
		return 'no error'
	}

	$mol_test({

		'binary precedence'() {
			$mol_assert_equal( expr( 'a + b * c - d' ), '(- (+ a (* b c)) d)' )
			$mol_assert_equal( expr( 'a ?? b || c && d' ), '(?? a (|| b (&& c d)))' )
			$mol_assert_equal( expr( 'a == b < c' ), '(== a (< b c))' )
			$mol_assert_equal( expr( '( a + b ) * c' ), '(* (+ a b) c)' )
		},

		'unary binds tighter than binary'() {
			$mol_assert_equal( expr( '!a && -b * c' ), '(&& (! a) (* (- b) c))' )
		},

		'cond nests to the right'() {
			$mol_assert_equal( expr( 'a == b ? c : d ? e : f' ), '(? (== a b) c (? d e f))' )
		},

		'postfix chain'() {
			$mol_assert_equal( expr( 'cart.qty( sku, 1 )?.qty.x' ), '(. (?. (call (. cart qty) sku 1) qty) x)' )
		},

		'literals'() {
			$mol_assert_equal( expr( '[ 1, 2.5, ... xs, true, none ]' ), '[1 2.5 ...xs true none]' )
			$mol_assert_equal( expr( '[]' ), '[]' )
		},

		'text interpolation'() {
			$mol_assert_equal( expr( '"{sku} x{qty + 1} = \\{sum\\}\\n"' ), '(text sku " x" (+ qty 1) " = {sum}\\n")' )
			$mol_assert_equal( expr( '"plain"' ), '"plain"' )
		},

		'object with binds'() {
			$mol_assert_equal( expr( '$bog_wire_parse_line {\n\t\tsku <= key\n\t\tcart <= cart.main\n\t}' ), '($bog_wire_parse_line sku<=key cart<=(. cart main))' )
			$mol_assert_equal( expr( '$bog_wire_parse_cart()' ), '($bog_wire_parse_cart)' )
		},

		'record with short and named fields'() {
			$mol_assert_equal( expr( '$bog_wire_parse_item{ sku, qty: n + 1 }' ), '($bog_wire_parse_item sku qty:(+ n 1))' )
		},

		'members'() {
			const source = [
				'object $bog_wire_parse_x {',
				'	sku: text',
				'	solid items( next?: list $bog_wire_parse_item ) = next ?? []',
				'	qty( sku: text ): int = 0',
				'	total = 1',
				'	action add( sku: text, n: int ) {',
				'		items( [] )',
				'		cart.set( sku, n )',
				'	}',
				'}',
			].join( '\n' )
			$mol_assert_equal( $bog_wire_ast_dump( $bog_wire_parse( source ) ), [
				'(object $bog_wire_parse_x',
				'	(abstract sku text)',
				'	(memo solid items (next?: list $bog_wire_parse_item) (?? next []))',
				'	(memo qty (sku: text) : int 0)',
				'	(memo total 1)',
				'	(action add (sku: text, n: int) (call items []) (call (. cart set) sku n)))',
			].join( '\n' ) )
		},

		'record type'() {
			$mol_assert_equal( $bog_wire_ast_dump( $bog_wire_parse( 'type $bog_wire_parse_item {\n\tsku: text\n\tqty: int?\n}' ) ), '(type $bog_wire_parse_item (sku text) (qty int?))' )
		},

		'syntax errors point to place'() {
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\tsku\n}' ), 'Expected = 3:1' )
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\tsolid sku: text\n}' ), 'Expected = 3:1' )
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\te = $bog_wire_parse_y( 1 )\n}' ), 'Objects take no arguments, bind properties with <= 2:25' )
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\te( next?: int, a: int ) = 1\n}' ), 'Only the last param can be next 2:5' )
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\te = "a{b c}"\n}' ), 'Expected } 2:11' )
			$mol_assert_equal( failure( 'object $bog_wire_parse_x {\n\te = "a\\q"\n}' ), 'Unknown escape 2:8' )
			$mol_assert_equal( failure( 'thing $bog_wire_parse_x {}' ), 'Expected type or object 1:1' )
		},

	})

}
