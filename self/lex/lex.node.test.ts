namespace $ {

	const root = 'bog/wire/self/lex'

	function expected( source: string ) {
		try {
			return $bog_wire_lex( source ).map( token => `${ token.kind } ${ token.span.row } ${ token.span.col } ${ token.span.length } ${ token.text }` )
		} catch( error: any ) {
			return [ `error ${ error.span.row }:${ error.span.col } ${ error.reason }` ]
		}
	}

	function actual( path: string ) {
		const run = $node.child_process.spawnSync( `${ root }/-/native`, [], { input: path + '\n', encoding: 'utf8' } )
		$mol_assert_equal( run.status, 0 )
		return run.stdout.replace( /\n$/, '' ).split( '\n' )
	}

	function sample( name: string, source: string ) {
		const path = `${ root }/-/${ name }.txt`
		$node.fs.writeFileSync( path, source )
		return actual( path )
	}

	function sources( dir: string ): string[] {
		return $node.fs.readdirSync( dir, { withFileTypes: true } ).flatMap( entry => {
			const path = `${ dir }/${ entry.name }`
			if( entry.isDirectory() ) return entry.name === '-' ? [] : sources( path )
			return entry.name.endsWith( '.wire' ) ? [ path ] : []
		} )
	}

	$mol_test({

		'native lexer is built'() {
			$mol_assert_equal( $bog_wire_cli([ 'build', root ]), 0 )
		},

		'tokens of shop sources match ts lexer'() {
			const files = sources( 'bog/wire/shop' )
			$mol_assert_equal( files.length > 3, true )
			for( const file of files ) {
				$mol_assert_equal( actual( file ), expected( $node.fs.readFileSync( file, 'utf8' ) ) )
			}
		},

		'tokens of own source match ts lexer'() {
			for( const file of sources( root ) ) {
				$mol_assert_equal( actual( file ), expected( $node.fs.readFileSync( file, 'utf8' ) ) )
			}
		},

		'edge cases match ts lexer'() {
			const cases = [
				'a<=b...c?.d??e!=f&&g||h',
				'x = 1.5 + 2. + .3 + 42',
				'"plain" "with {nested "inner \\" text" ok} tail" "esc \\" \\{"',
				'a\r\nb\t\tc\n\n  d',
				'$ a',
				'$a1_b',
				'"unclosed',
				'"unclosed\nnext"',
				'a \\ b',
				'a # b',
				'',
				'\n\n',
			]
			cases.forEach( ( source, index ) => {
				$mol_assert_equal( sample( `case${ index }`, source ), expected( source ) )
			} )
		},

	})

}
