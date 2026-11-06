namespace $ {

	function kinds( source: string ) {
		return $bog_wire_lex( source ).map( token => `${ token.kind }:${ token.text }` )
	}

	function failure( source: string ) {
		try {
			$bog_wire_lex( source )
		} catch( error: any ) {
			return `${ error.reason } ${ error.span.row }:${ error.span.col }`
		}
		return 'no error'
	}

	$mol_test({

		'names, fqns, numbers and puncts'() {
			$mol_assert_equal( kinds( 'solid items( next?: list $bog_wire_lex_x ) = next ?? [ 1, 2.5 ]' ), [
				'name:solid', 'name:items', 'punct:(', 'name:next', 'punct:?', 'punct::', 'name:list', 'fqn:$bog_wire_lex_x', 'punct:)',
				'punct:=', 'name:next', 'punct:??', 'punct:[', 'number:1', 'punct:,', 'number:2.5', 'punct:]', 'end:',
			] )
		},

		'longest punct wins'() {
			$mol_assert_equal( kinds( 'a<=b...c?.d??e!=f' ), [
				'name:a', 'punct:<=', 'name:b', 'punct:...', 'name:c', 'punct:?.', 'name:d', 'punct:??', 'name:e', 'punct:!=', 'name:f', 'end:',
			] )
		},

		'text keeps raw content'() {
			$mol_assert_equal( kinds( '"a\\"b{x}"' ), [ 'text:a\\"b{x}', 'end:' ] )
		},

		'spans count rows and cols'() {
			const tokens = $bog_wire_lex( 'object $bog_wire_lex_x {\n\tqty = 1\n}' )
			$mol_assert_equal( tokens.map( token => `${ token.text }@${ token.span.row }:${ token.span.col }` ), [
				'object@1:1', '$bog_wire_lex_x@1:8', '{@1:24', 'qty@2:2', '=@2:6', '1@2:8', '}@3:1', '@3:2',
			] )
		},

		'unclosed text'() {
			$mol_assert_equal( failure( 'a = "abc\nb' ), 'Unclosed text 1:5' )
		},

		'unexpected char'() {
			$mol_assert_equal( failure( 'a = 1\n  # 2' ), 'Unexpected "#" 2:3' )
		},

	})

}
