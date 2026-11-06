namespace $ {

	function build( sources: { uri: string, text: string }[] ) {
		const modules = sources.map( source => $bog_wire_parse( source.text, source.uri ) )
		const check = new $bog_wire_check( modules )
		if( check.errors.length ) $mol_fail( new Error( check.errors.map( error => error.message ).join( '\n' ) ) )

		const dir = $node.fs.mkdtempSync( $node.path.join( $node.os.tmpdir(), 'bog_wire_' ) )
		$node.fs.writeFileSync( $node.path.join( dir, 'test.c' ), new $bog_wire_emit( check ).program() )
		for( const file of [ 'rt.c', 'rt.h' ] ) $node.fs.copyFileSync( `bog/wire/rt/${ file }`, $node.path.join( dir, file ) )

		const cc = $node.child_process.spawnSync( 'zig', [ 'cc', '-std=c11', '-O1', '-Werror', '-Wno-unused-variable', '-o', 'test', 'test.c', 'rt.c' ], { cwd: dir, encoding: 'utf8' } )
		if( cc.status ) $mol_fail( new Error( cc.stderr ) )

		const run = $node.child_process.spawnSync( './test', [], { cwd: dir, encoding: 'utf8' } )
		$node.fs.rmSync( dir, { recursive: true, force: true } )
		return { status: run.status, stdout: run.stdout, stderr: run.stderr }
	}

	function shop() {
		const paths = [ 'catalog/catalog.wire', 'cart/cart.wire', 'line/line.wire', 'shop.wire', 'shop.test.wire' ]
		return paths.map( path => {
			const uri = `bog/wire/shop/${ path }`
			return { uri, text: $node.fs.readFileSync( uri, 'utf8' ) }
		} )
	}

	$mol_test({

		'shop tests pass without leaks'() {
			$mol_assert_equal( build( shop() ), {
				status: 0,
				stdout: [
					'ok $bog_wire_shop_test.total_follows_cart',
					'ok $bog_wire_shop_test.removed_line_leaves_receipt',
					'',
				].join( '\n' ),
				stderr: '',
			} )
		},

		'failed assert fails the test'() {
			const result = build([{
				uri: 'bog/wire/emit/case.test.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	solid count( next?: int ) = next ?? 1',
					'	twice = count * 2',
					'	action wrong() {',
					'		count( 5 )',
					'		assert( twice == 11 )',
					'	}',
					'	action right() {',
					'		count( 5 )',
					'		assert( twice == 10 )',
					'	}',
					'}',
				].join( '\n' ),
			}])
			$mol_assert_equal( result, {
				status: 1,
				stdout: 'fail $bog_wire_emit_case.wrong\nok $bog_wire_emit_case.right\n',
				stderr: 'assert failed at bog/wire/emit/case.test.wire:6:9\n',
			} )
		},

		'values and objects are freed'() {
			const result = build([{
				uri: 'bog/wire/emit/case.test.wire',
				text: [
					'type $bog_wire_emit_case_pair {',
					'	name: text',
					'	size: int',
					'}',
					'object $bog_wire_emit_case_item {',
					'	name: text',
					'	label = "<{name}>"',
					'}',
					'object $bog_wire_emit_case {',
					'	solid pairs( next?: list $bog_wire_emit_case_pair ) = next ?? []',
					'	name_of( pair: $bog_wire_emit_case_pair ) = pair.name',
					'	size_of( pair: $bog_wire_emit_case_pair ) = pair.size',
					'	names = pairs.sort( size_of ).map( name_of )',
					'	item( name: text ) = $bog_wire_emit_case_item {',
					'		name <= name',
					'	}',
					'	label_of( item: $bog_wire_emit_case_item ) = item.label',
					'	labels = names.map( item ).map( label_of )',
					'	found( name: text ) = pairs.find( name_of, name )?.size ?? -1',
					'	action fill() {',
					'		pairs( [ $bog_wire_emit_case_pair{ name: "b", size: 2 }, $bog_wire_emit_case_pair{ name: "a", size: 1 } ] )',
					'		assert( labels == [ "<a>", "<b>" ] )',
					'		pairs( pairs.drop( name_of, "a" ) )',
					'		assert( labels == [ "<b>" ] )',
					'		assert( found( "b" ) == 2 )',
					'		assert( found( "z" ) == -1 )',
					'		pairs( pairs.upsert( name_of, "b", $bog_wire_emit_case_pair{ name: "b", size: 7 } ) )',
					'		assert( found( "b" ) == 7 )',
					'	}',
					'}',
				].join( '\n' ),
			}])
			$mol_assert_equal( result, { status: 0, stdout: 'ok $bog_wire_emit_case.fill\n', stderr: '' } )
		},

	})

}
