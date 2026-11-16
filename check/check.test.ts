namespace $ {

	function errors( ... lines: string[] ) {
		const check = new $bog_wire_check([ $bog_wire_parse( lines.join( '\n' ) ) ])
		return check.errors.map( error => `${ error.reason } @${ error.span.row }` )
	}

	const store = [
		'object $bog_wire_check_x {',
		'	solid items( next?: list int ) { return next ?? [] }',
		'	action reset() {',
		'		items( [] )',
		'	}',
	]

	const item = [
		'object $bog_wire_check_item {',
		'	sku: text',
		'	label() { return "#{sku}" }',
		'}',
	]

	$mol_test({

		'clean program has no errors'() {
			$mol_assert_equal( errors(
				... store,
				'	size() { return items.size }',
				'	first( index: int ) { return index * 2 }',
				'	doubled() { return items.map( first ) }',
				'	total() { return doubled.sum + size }',
				'	action push( value: int ) {',
				'		items( [ ... items, value ] )',
				'		reset()',
				'		assert( total >= 0 )',
				'	}',
				'}',
			), [] )
		},

		'memo can not write state'() {
			$mol_assert_equal( errors( ... store, '	bad() { return items( [ 1 ] ) }', '}' ), [ 'Write to items is allowed only in action @6' ] )
		},

		'memo can not call action'() {
			$mol_assert_equal( errors( ... store, '	bad() { return reset() }', '}' ), [ "Action reset can't be called from memo @6" ] )
		},

		'memo can not assert'() {
			$mol_assert_equal( errors( ... store, '	bad() { return assert( true ) }', '}' ), [ 'assert is allowed only in action @6' ] )
		},

		'action statement must have effect'() {
			$mol_assert_equal( errors( ... store, '	action noop() {', '		items.size', '	}', '}' ), [ 'Statement must write state, call action or assert @7' ] )
		},

		'abstract property must be bound'() {
			$mol_assert_equal( errors(
				... item,
				'object $bog_wire_check_x {',
				'	ok() { return $bog_wire_check_item{ sku <= "tea" } }',
				'	none_bound() { return $bog_wire_check_item() }',
				'	wrong() { return $bog_wire_check_item{ sku <= 1 } }',
				'	extra() { return $bog_wire_check_item{ sku <= "a", label <= "b" } }',
				'}',
			), [
				'Property sku is not bound @7',
				'Expected text, got int @8',
				'$bog_wire_check_item has no property label to bind @9',
			] )
		},

		'abstract property takes same name from owner'() {
			$mol_assert_equal( errors(
				... item,
				'object $bog_wire_check_x {',
				'	sku() { return "tea" }',
				'	own() { return $bog_wire_check_item() }',
				'}',
				'object $bog_wire_check_y {',
				'	keyed( sku: text ) { return $bog_wire_check_item() }',
				'}',
				'object $bog_wire_check_z {',
				'	sku() { return 1 }',
				'	wrong() { return $bog_wire_check_item() }',
				'}',
			), [
				'Expected text for sku, got int @14',
			] )
		},

		'keyed method reading only params is pure'() {
			const module = $bog_wire_parse( [
				'type $bog_wire_check_pair {',
				'	id: text',
				'	qty: int',
				'}',
				'object $bog_wire_check_x {',
				'	solid base( next?: int ) { return next ?? 1 }',
				'	id_of( pair: $bog_wire_check_pair ) { return pair.id }',
				'	twice( n: int ) { return n * 2 }',
				'	shifted( n: int ) { return n + base }',
				'	wrapped( n: int ) { return $bog_wire_check_pair{ id: "x", qty: n } }',
				'	total() { return base * 2 }',
				'}',
			].join( '\n' ) )
			const check = new $bog_wire_check([ module ])
			$mol_assert_equal( check.errors.length, 0 )

			const owner = module.decls.find( decl => decl.kind === 'object' )!
			if( owner.kind !== 'object' ) return
			const pure = owner.members.filter( member => check.pure( member ) ).map( member => member.name )
			$mol_assert_equal( pure, [ 'id_of', 'twice', 'wrapped' ] )
		},

		'same name in param and method needs explicit bind'() {
			$mol_assert_equal( errors(
				... item,
				'object $bog_wire_check_x {',
				'	sku() { return "tea" }',
				'	both( sku: text ) { return $bog_wire_check_item() }',
				'	explicit( sku: text ) { return $bog_wire_check_item{ sku <= sku } }',
				'}',
			), [
				'Both param and method sku fit, bind it with <= @7',
			] )
		},

		'unknown names'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	a() { return missing + 1 }',
				'	b() { return $bog_wire_check_y() }',
				'	c: $bog_wire_check_z',
				'}',
			), [
				'Unknown missing @2',
				'Unknown $bog_wire_check_y @3',
				'Unknown $bog_wire_check_z @4',
			] )
		},

		'operand types'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	a() { return 1 + "x" }',
				'	b() { return 1 ?? 2 }',
				'	c() { return 1.5 * 2 }',
				'	d() { return !1 }',
				'	e() { return true ? 1 : "x" }',
				'	f() { return "{[ 1 ]}" }',
				'}',
			), [
				"Can't apply + to int and text @2",
				'int is never none @3',
				"Can't apply * to float and int @4",
				'Expected bool, got int @5',
				'Branches differ: int and text @6',
				"Can't put list int into text @7",
			] )
		},

		'maybe needs ?. and ??'() {
			$mol_assert_equal( errors(
				... item,
				'object $bog_wire_check_x {',
				'	solid found( next?: $bog_wire_check_item ) { return next }',
				'	bad() { return found.sku }',
				'	good(): text { return found?.sku ?? "" }',
				'	never() { return good?.size }',
				'}',
			), [
				'$bog_wire_check_item? may be none, use ?. @7',
				'text is never none, use . @9',
			] )
		},

		'recursive inference needs declared type'() {
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a() { return b + 1 }', '	b() { return a }', '}' ), [ "Can't infer type of a, declare it @2" ] )
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a(): int { return b + 1 }', '	b() { return a }', '}' ), [] )
		},

		'declared type is checked'() {
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a(): text { return 1 }', '}' ), [ 'Expected text, got int @2' ] )
		},

		'list operations take methods'() {
			$mol_assert_equal( errors(
				... store,
				'	label( name: text ) { return name }',
				'	pair( a: int, b: int ) { return a + b }',
				'	twice( n: int ) { return n * 2 }',
				'	a() { return items.map( label ) }',
				'	b() { return items.map( pair ) }',
				'	c() { return items.map( 1 ) }',
				'	d() { return items.find( twice, "x" ) }',
				'	e() { return items.upsert( twice, 2, "x" ) }',
				'	f() { return items.reduce( twice ) }',
				'}',
			), [
				'label takes text, list has int @9',
				'pair must take one key @10',
				'Expected method, got int @11',
				'Expected int, got text @12',
				'Expected int, got text @13',
				'List has no reduce @14',
			] )
		},

		'records need all fields'() {
			$mol_assert_equal( errors(
				'type $bog_wire_check_item {',
				'	sku: text',
				'	qty: int',
				'}',
				'object $bog_wire_check_x {',
				'	sku() { return "tea" }',
				'	a() { return $bog_wire_check_item{ sku, qty: 1 } }',
				'	b() { return $bog_wire_check_item{ sku } }',
				'	c() { return $bog_wire_check_item{ sku, qty <= 1 } }',
				'}',
			), [
				'Field qty is not set @8',
				'Record $bog_wire_check_item takes fields, not binds @9',
			] )
		},

		'keyed call arity'() {
			$mol_assert_equal( errors(
				... store,
				'	twice( n: int ) { return n * 2 }',
				'	a() { return twice() }',
				'	b() { return twice( 1, 2 ) }',
				'}',
			), [
				'twice takes 1 args @7',
				'twice takes 1 args @8',
			] )
		},

		'print, after and join'() {
			$mol_assert_equal( errors(
				... store,
				'	twice( n: int ) { return n * 2 }',
				'	bad_after() { return after( reset ) }',
				'	action ok() {',
				'		print( "{items.size}" )',
				'		after( reset )',
				'	}',
				'	action wrong() {',
				'		print( 1 )',
				'		after( twice )',
				'		after( wrong_args )',
				'		print( items.join( "," ) )',
				'	}',
				'	action wrong_args( n: int ) {',
				'		reset()',
				'	}',
				'}',
			), [
				'after is allowed only in action @7',
				'Expected text, got int @13',
				'twice is not an action @14',
				'Action wrong_args for after must take no params @15',
				"Can't join list int @16",
			] )
		},

		'stdin and branches in actions'() {
			$mol_assert_equal( errors(
				... store,
				'	line() { return stdin( size ) }',
				'	size() { return items.size }',
				'	shout(): text { return line ?? "" }',
				'	bad_index() { return stdin( "x" ) }',
				'	action ok() {',
				'		line == none ? reset() : print( shout )',
				'		size > 1 ? reset() : none',
				'	}',
				'	action wrong() {',
				'		size > 1 ? reset() : size',
				'	}',
				'}',
			), [
				'Expected int, got text @9',
				'Branches differ: void and int @15',
				'Statement must write state, call action or assert @15',
			] )
		},

		'file reads in memo, write and exec only in action'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	body() { return file( "a" ) ?? "" }',
				'	bad_write() { return write( "a", "b" ) }',
				'	bad_exec() { return exec( "a", [] ) }',
				'	bad_file() { return file( 1 ) }',
				'	action run() {',
				'		write( "a", 1 )',
				'		exec( "a", "b" )',
				'		assert( write( "a", "b" ) && exec( "a", [ "b" ] ) == 0 )',
				'	}',
				'}',
			), [
				'write is allowed only in action @3',
				'exec is allowed only in action @4',
				'Expected text, got int @5',
				'Expected text, got int @7',
				'Expected list text, got text @8',
			] )
		},

		'fold takes pure method with accumulator and item'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	items: list int',
				'	solid state( next?: int ) { return next ?? 0 }',
				'	add( acc: int, item: int ) { return acc + item }',
				'	reads( acc: int, item: int ) { return acc + state }',
				'	short( item: int ) { return item }',
				'	wide( acc: text, item: int ) { return acc }',
				'	wrong( acc: int, item: int ) { return "{ acc }" }',
				'	ok() { return items.fold( add, 0 ) }',
				'	bad_reads() { return items.fold( reads, 0 ) }',
				'	bad_short() { return items.fold( short, 0 ) }',
				'	bad_item() { return [ "a" ].fold( add, 0 ) }',
				'	bad_init() { return items.fold( add, "" ) }',
				'	bad_wide() { return items.fold( wide, 0 ) }',
				'	bad_result() { return items.fold( wrong, 0 ) }',
				'}',
			), [
				'reads must read only its params @10',
				'short must take accumulator and item @11',
				'add takes int, list has text @12',
				'Expected int, got text @13',
				'Expected text, got int @14',
				'wrong returns text, accumulator is int @15',
			] )
		},

		'dict keys, values and operations'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	ages: dict text int',
				'	ok() { return ages.set( "a", 1 ).get( "a" ) ?? ages.size }',
				'	names(): list text { return ages.keys }',
				'	bad_key_type(): dict float int { return [:] }',
				'	bad_key_literal() { return [ 1.5: 1 ] }',
				'	bad_get() { return ages.get( 1 ) }',
				'	bad_set() { return ages.set( "a", "b" ) }',
				'	mixed() { return [ "a": 1, 2: 3 ] }',
				'	bad_op() { return ages.drop( "a" ) }',
				'	bad_field() { return ages.values }',
				'}',
			), [
				'Dict key must be int or text, got float @5',
				'Dict key must be int or text, got float @6',
				'Expected text, got int @7',
				'Expected int, got text @8',
				'Expected text, got int @9',
				'Dict has no drop @10',
				'Dict has no values @11',
			] )
		},

		'pure method may call pure methods of its owner'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	items: list int',
				'	solid state( next?: int ) { return next ?? 0 }',
				'	twice( value: int ) { return value * 2 }',
				'	deep( value: int ): int { return value > 0 ? deep( value - 1 ) : twice( value ) }',
				'	reads( value: int ) { return value + state }',
				'	indirect( value: int ) { return reads( value ) }',
				'	good( acc: int, item: int ) { return acc + deep( item ) }',
				'	bad( acc: int, item: int ) { return acc + indirect( item ) }',
				'	ok() { return items.fold( good, 0 ) }',
				'	not_ok() { return items.fold( bad, 0 ) }',
				'}',
			), [
				'bad must read only its params @11',
			] )
		},

		'duplicates'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	a() { return 1 }',
				'	a() { return 2 }',
				'}',
				'object $bog_wire_check_x {}',
			), [
				'$bog_wire_check_x is already declared @5',
				'a is already declared @3',
			] )
		},

	})

}
