namespace $ {

	function build( sources: { uri: string, text: string }[], mode: 'test' | 'native' = 'test', input = '' ) {
		const modules = sources.map( source => $bog_wire_parse( source.text, source.uri ) )
		const check = new $bog_wire_check( modules )
		if( check.errors.length ) $mol_fail( new Error( check.errors.map( error => error.message ).join( '\n' ) ) )

		const dir = $node.fs.mkdtempSync( $node.path.join( $node.os.tmpdir(), 'bog_wire_' ) )
		$node.fs.writeFileSync( $node.path.join( dir, 'test.c' ), new $bog_wire_emit( check ).program( mode ) )
		for( const file of [ 'rt.c', 'rt.h' ] ) $node.fs.copyFileSync( `bog/wire/rt/${ file }`, $node.path.join( dir, file ) )

		const cc = $node.child_process.spawnSync( 'zig', [ 'cc', '-std=c11', '-O1', '-Werror', '-Wno-unused-variable', '-o', 'test', 'test.c', 'rt.c' ], { cwd: dir, encoding: 'utf8' } )
		if( cc.status ) $mol_fail( new Error( cc.stderr ) )

		const run = $node.child_process.spawnSync( './test', [], { cwd: dir, encoding: 'utf8', input } )
		$node.fs.rmSync( dir, { recursive: true, force: true } )
		return { status: run.status, stdout: run.stdout, stderr: run.stderr }
	}

	function shop( entry = 'shop.test.wire' ) {
		const paths = [ 'catalog/catalog.wire', 'cart/cart.wire', 'line/line.wire', 'shop.wire', entry ]
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

		'native main runs tasks with tick between'() {
			$mol_assert_equal( build( shop( 'shop.native.wire' ), 'native' ), {
				status: 0,
				stdout: [
					'tea x1 = 120', 'cake x1 = 300', 'total 420', '--',
					'tea x2 = 240', 'cake x1 = 280', 'total 520', '--',
					'cake x1 = 280', 'total 280', '--',
					'',
				].join( '\n' ),
				stderr: '',
			} )
		},

		'after on other object and print'() {
			const result = build([{
				uri: 'bog/wire/emit/case.native.wire',
				text: [
					'object $bog_wire_emit_case_log {',
					'	solid lines( next?: list text ) = next ?? []',
					'	action flush() {',
					'		print( lines.join( "," ) )',
					'	}',
					'}',
					'object $bog_wire_emit_case {',
					'	solid log = $bog_wire_emit_case_log()',
					'	action main() {',
					'		log.lines( [ "a", "b" ] )',
					'		after( log.flush )',
					'		print( "first" )',
					'	}',
					'}',
				].join( '\n' ),
			}], 'native' )
			$mol_assert_equal( result, { status: 0, stdout: 'first\na,b\n', stderr: '' } )
		},

		'repl waits for each line'() {
			const result = build([{
				uri: 'bog/wire/emit/case.native.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	solid seen( next?: int ) = next ?? 0',
					'	line = stdin( seen )',
					'	said = line ?? ""',
					'	shout = "> {said}"',
					'	action main() {',
					'		step()',
					'	}',
					'	action step() {',
					'		line == none ? print( "bye" ) : echo()',
					'	}',
					'	action echo() {',
					'		print( shout )',
					'		seen( seen + 1 )',
					'		after( step )',
					'	}',
					'}',
				].join( '\n' ),
			}], 'native', 'a\nb\n' )
			$mol_assert_equal( result, { status: 0, stdout: '> a\n> b\nbye\n', stderr: '' } )
		},

		'action retry skips done effects'() {
			const result = build([{
				uri: 'bog/wire/emit/case.native.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	solid count( next?: int ) = next ?? 0',
					'	prefix = "<"',
					'	first = prefix + ( stdin( 0 ) ?? "-" )',
					'	second = stdin( 1 ) ?? "-"',
					'	action main() {',
					'		print( "start" )',
					'		count( count + 1 )',
					'		print( "got {first}" )',
					'		count( count + 1 )',
					'		print( "then {second}" )',
					'		print( "count {count}" )',
					'	}',
					'}',
				].join( '\n' ),
			}], 'native', 'x\ny' )
			$mol_assert_equal( result, { status: 0, stdout: 'start\ngot <x\nthen y\ncount 2\n', stderr: '' } )
		},

		'stdin is empty in tests'() {
			const result = build([{
				uri: 'bog/wire/emit/case.test.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	action empty() {',
					'		assert( stdin( 0 ) == none )',
					'	}',
					'}',
				].join( '\n' ),
			}], 'test', 'ignored\n' )
			$mol_assert_equal( result, { status: 0, stdout: 'ok $bog_wire_emit_case.empty\n', stderr: '' } )
		},

		'logic short circuits recursion'() {
			const result = build([{
				uri: 'bog/wire/emit/case.test.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	down( n: int ): bool = n > 0 && down( n - 1 )',
					'	up( n: int ): bool = n <= 0 || up( n - 1 )',
					'	action stops() {',
					'		assert( !down( 5 ) )',
					'		assert( up( 5 ) )',
					'	}',
					'}',
				].join( '\n' ),
			}] )
			$mol_assert_equal( result, { status: 0, stdout: 'ok $bog_wire_emit_case.stops\n', stderr: '' } )
		},

		'text operations'() {
			const result = build([{
				uri: 'bog/wire/emit/case.test.wire',
				text: [
					'object $bog_wire_emit_case {',
					'	line = "  A1 = 2 + 3  "',
					'	clean = line.trim',
					'	eq = clean.find( "=" ) ?? -1',
					'	name = clean.slice( 0, eq ).trim',
					'	source = clean.slice( eq + 1, clean.size ).trim',
					'	parts = source.split( " + " )',
					'	action ops() {',
					'		assert( clean == "A1 = 2 + 3" )',
					'		assert( eq == 3 )',
					'		assert( name == "A1" )',
					'		assert( parts == [ "2", "3" ] )',
					'		assert( "42".int == 42 )',
					'		assert( "4x".int == none )',
					'		assert( "2.5".float == 2.5 )',
					'		assert( "жук".size == 3 )',
					'		assert( "жук".chars == [ "ж", "у", "к" ] )',
					'		assert( "жук".slice( 1, 3 ) == "ук" )',
					'		assert( "x".find( "y" ) == none )',
					'		assert( "a{ name + "!" }c" == "aA1!c" )',
					'	}',
					'}',
				].join( '\n' ),
			}] )
			$mol_assert_equal( result, { status: 0, stdout: 'ok $bog_wire_emit_case.ops\n', stderr: '' } )
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
