namespace $ {

	$mol_test({

		'shop example checks clean'() {
			const paths = [ 'catalog/catalog.wire', 'cart/cart.wire', 'line/line.wire', 'shop.wire', 'shop.test.wire' ]
			const modules = paths.map( path => {
				const uri = `bog/wire/shop/${ path }`
				return $bog_wire_parse( $node.fs.readFileSync( uri, 'utf8' ), uri )
			} )
			const check = new $bog_wire_check( modules )
			$mol_assert_equal( check.errors.map( error => error.message ), [] )
		},

	})

}
