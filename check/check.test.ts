namespace $ {

	function errors( ... lines: string[] ) {
		const check = new $bog_wire_check([ $bog_wire_parse( lines.join( '\n' ) ) ])
		return check.errors.map( error => `${ error.reason } @${ error.span.row }` )
	}

	const store = [
		'object $bog_wire_check_x {',
		'	solid items( next?: list int ) = next ?? []',
		'	action reset() {',
		'		items( [] )',
		'	}',
	]

	const item = [
		'object $bog_wire_check_item {',
		'	sku: text',
		'	label = "#{sku}"',
		'}',
	]

	$mol_test({

		'clean program has no errors'() {
			$mol_assert_equal( errors(
				... store,
				'	size = items.size',
				'	first( index: int ) = index * 2',
				'	doubled = items.map( first )',
				'	total = doubled.sum + size',
				'	action push( value: int ) {',
				'		items( [ ... items, value ] )',
				'		reset()',
				'		assert( total >= 0 )',
				'	}',
				'}',
			), [] )
		},

		'memo can not write state'() {
			$mol_assert_equal( errors( ... store, '	bad = items( [ 1 ] )', '}' ), [ 'Write to items is allowed only in action @6' ] )
		},

		'memo can not call action'() {
			$mol_assert_equal( errors( ... store, '	bad = reset()', '}' ), [ "Action reset can't be called from memo @6" ] )
		},

		'memo can not assert'() {
			$mol_assert_equal( errors( ... store, '	bad = assert( true )', '}' ), [ 'assert is allowed only in action @6' ] )
		},

		'action statement must have effect'() {
			$mol_assert_equal( errors( ... store, '	action noop() {', '		items.size', '	}', '}' ), [ 'Statement must write state, call action or assert @7' ] )
		},

		'abstract property must be bound'() {
			$mol_assert_equal( errors(
				... item,
				'object $bog_wire_check_x {',
				'	ok = $bog_wire_check_item{ sku <= "tea" }',
				'	none_bound = $bog_wire_check_item()',
				'	wrong = $bog_wire_check_item{ sku <= 1 }',
				'	extra = $bog_wire_check_item{ sku <= "a", label <= "b" }',
				'}',
			), [
				'Property sku is not bound @7',
				'Expected text, got int @8',
				'$bog_wire_check_item has no property label to bind @9',
			] )
		},

		'unknown names'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	a = missing + 1',
				'	b = $bog_wire_check_y()',
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
				'	a = 1 + "x"',
				'	b = 1 ?? 2',
				'	c = 1.5 * 2',
				'	d = !1',
				'	e = true ? 1 : "x"',
				'	f = "{[ 1 ]}"',
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
				'	solid found( next?: $bog_wire_check_item ) = next',
				'	bad = found.sku',
				'	good: text = found?.sku ?? ""',
				'	never = good?.size',
				'}',
			), [
				'$bog_wire_check_item? may be none, use ?. @7',
				'text is never none, use . @9',
			] )
		},

		'recursive inference needs declared type'() {
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a = b + 1', '	b = a', '}' ), [ "Can't infer type of a, declare it @2" ] )
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a: int = b + 1', '	b = a', '}' ), [] )
		},

		'declared type is checked'() {
			$mol_assert_equal( errors( 'object $bog_wire_check_x {', '	a: text = 1', '}' ), [ 'Expected text, got int @2' ] )
		},

		'list operations take methods'() {
			$mol_assert_equal( errors(
				... store,
				'	label( name: text ) = name',
				'	pair( a: int, b: int ) = a + b',
				'	twice( n: int ) = n * 2',
				'	a = items.map( label )',
				'	b = items.map( pair )',
				'	c = items.map( 1 )',
				'	d = items.find( twice, "x" )',
				'	e = items.upsert( twice, 2, "x" )',
				'	f = items.fold( twice )',
				'}',
			), [
				'label takes text, list has int @9',
				'pair must take one key @10',
				'Expected method, got int @11',
				'Expected int, got text @12',
				'Expected int, got text @13',
				'List has no fold @14',
			] )
		},

		'records need all fields'() {
			$mol_assert_equal( errors(
				'type $bog_wire_check_item {',
				'	sku: text',
				'	qty: int',
				'}',
				'object $bog_wire_check_x {',
				'	sku = "tea"',
				'	a = $bog_wire_check_item{ sku, qty: 1 }',
				'	b = $bog_wire_check_item{ sku }',
				'	c = $bog_wire_check_item{ sku, qty <= 1 }',
				'}',
			), [
				'Field qty is not set @8',
				'Record $bog_wire_check_item takes fields, not binds @9',
			] )
		},

		'keyed call arity'() {
			$mol_assert_equal( errors(
				... store,
				'	twice( n: int ) = n * 2',
				'	a = twice()',
				'	b = twice( 1, 2 )',
				'}',
			), [
				'twice takes 1 args @7',
				'twice takes 1 args @8',
			] )
		},

		'print, after and join'() {
			$mol_assert_equal( errors(
				... store,
				'	twice( n: int ) = n * 2',
				'	bad_after = after( reset )',
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

		'duplicates'() {
			$mol_assert_equal( errors(
				'object $bog_wire_check_x {',
				'	a = 1',
				'	a = 2',
				'}',
				'object $bog_wire_check_x {}',
			), [
				'$bog_wire_check_x is already declared @5',
				'a is already declared @3',
			] )
		},

	})

}
