namespace $ {

	function shop( path: string ) {
		const uri = `bog/wire/shop/${ path }`
		return $bog_wire_parse( $node.fs.readFileSync( uri, 'utf8' ), uri )
	}

	$mol_test({

		'shop sources parse'() {
			const names = [ 'catalog/catalog.wire', 'cart/cart.wire', 'line/line.wire', 'shop.wire', 'shop.test.wire' ]
				.flatMap( path => shop( path ).decls.map( decl => `${ decl.kind } ${ decl.name }` ) )

			$mol_assert_equal( names, [
				'record $bog_wire_shop_price',
				'object $bog_wire_shop_catalog',
				'record $bog_wire_shop_cart_item',
				'object $bog_wire_shop_cart',
				'object $bog_wire_shop_line',
				'object $bog_wire_shop',
				'object $bog_wire_shop_test',
			] )
		},

		'cart parses to expected tree'() {
			$mol_assert_equal( $bog_wire_ast_dump( shop( 'cart/cart.wire' ) ), [
				'(type $bog_wire_shop_cart_item (sku text) (qty int))',
				'(object $bog_wire_shop_cart',
				'	(memo solid items (next?: list $bog_wire_shop_cart_item) (?? next []))',
				'	(memo sku_of (item: $bog_wire_shop_cart_item) (. item sku))',
				'	(memo skus (call (. items map) sku_of))',
				'	(memo item (sku: text) (call (. items find) sku_of sku))',
				'	(memo qty (sku: text) (?? (?. (call item sku) qty) 0))',
				'	(action set (sku: text, count: int) (call items (? (> count 0) (call (. items upsert) sku_of sku ($bog_wire_shop_cart_item sku qty:count)) (call (. items drop) sku_of sku)))))',
			].join( '\n' ) )
		},

		'shop binds line properties'() {
			const line = shop( 'shop.wire' ).decls[0]
			if( line.kind !== 'object' ) $mol_fail( new Error( 'object expected' ) )
			$mol_assert_equal(
				$bog_wire_ast_dump({ uri: '', decls: [{ ... line, members: line.members.filter( member => member.name === 'line' ) }] }),
				'(object $bog_wire_shop\n\t(memo line (sku: text) ($bog_wire_shop_line sku<=sku cart<=cart catalog<=catalog)))',
			)
		},

	})

}
