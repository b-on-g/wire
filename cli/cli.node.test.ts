namespace $ {

	$mol_test({

		'cli builds hello without builder'() {
			$mol_assert_equal( $bog_wire_cli([ 'build', 'bog/wire/demonative/hello' ]), 0 )
			const run = $node.child_process.spawnSync( 'bog/wire/demonative/hello/-/native', [], { encoding: 'utf8' } )
			$mol_assert_equal( { status: run.status, stdout: run.stdout }, { status: 0, stdout: 'Hello, World!\n' } )
		},

		'cli cross compiles with target'() {
			$mol_assert_equal( $bog_wire_cli([ 'build', 'bog/wire/demonative/hello', '--target', 'x86_64-windows-gnu' ]), 0 )
			const head = $node.fs.readFileSync( 'bog/wire/demonative/hello/-/native' ).subarray( 0, 2 ).toString( 'latin1' )
			$mol_assert_equal( head, 'MZ' )
			$mol_assert_equal( $bog_wire_cli([ 'build', 'bog/wire/demonative/hello' ]), 0 )
		},

		'cli prints c'() {
			const run = $node.child_process.spawnSync( 'node', [ 'bog/wire/cli/-/node.js', 'c', 'bog/wire/demonative/hello' ], { encoding: 'utf8' } )
			$mol_assert_equal( run.status, 0 )
			$mol_assert_equal( run.stdout.includes( 'return wire_main( &C_bog_wire_demonative_hello, A_bog_wire_demonative_hello__main );' ), true )
		},

		'cli refuses module without main'() {
			$mol_assert_equal( $bog_wire_cli([ 'build', 'bog/wire/demonative/sheet' ]), 1 )
		},

	})

}
