namespace $ {

	type Mode = 'test' | 'native'

	function folder( root: string, path: string ) {
		const full = $node.path.join( root, path )
		return $node.fs.existsSync( full ) && $node.fs.statSync( full ).isDirectory()
	}

	function resolve( root: string, name: string ) {
		let path = name.replace( /_/g, '/' )
		while( path && !folder( root, path ) ) path = path.replace( /\/?[^/]*$/, '' )
		return path
	}

	function load( root: string, pack: string, mode: Mode ) {
		const modules = [] as $bog_wire_ast_module[]
		const seen = new Set< string >()
		const queue = [ pack ]

		while( queue.length ) {
			const dir = queue.shift()!
			if( seen.has( dir ) || !folder( root, dir ) ) continue
			seen.add( dir )

			for( const name of $node.fs.readdirSync( $node.path.join( root, dir ) ).sort() ) {
				if( !/^[a-z0-9].*\.wire$/i.test( name ) ) continue
				if( /\.web\./.test( name ) ) continue
				if( mode === 'native' && /\.test\./.test( name ) ) continue

				const uri = `${ dir }/${ name }`
				const text = $node.fs.readFileSync( $node.path.join( root, uri ), 'utf8' )
				modules.push( $bog_wire_parse( text, uri ) )

				for( const [ , fqn ] of text.replace( /"(\\.|[^"\\\n])*"/g, '""' ).matchAll( /\$([a-z][a-z0-9_]*)/gi ) ) {
					const found = resolve( root, fqn )
					if( found ) queue.push( found )
				}
			}
		}

		return modules
	}

	export function $bog_wire_cli( args: string[], root = $node.process.cwd() ) {
		const [ command, target ] = args

		if( !target || ![ 'build', 'test', 'c' ].includes( command ) ) {
			console.error( 'usage: wire build|test|c <module>' )
			return 2
		}

		const pack = target.replace( /\/+$/, '' )
		const mode: Mode = command === 'test' ? 'test' : 'native'
		const check = new $bog_wire_check( load( root, pack, mode ) )

		if( check.errors.length ) {
			for( const error of check.errors ) console.error( error.message )
			return 1
		}

		const code = new $bog_wire_emit( check ).program( mode, pack )

		if( command === 'c' ) {
			$node.process.stdout.write( code )
			return 0
		}

		if( !/\nint main\(/.test( code ) ) {
			console.error( mode === 'test' ? `no tests in ${ pack }` : `no action main in ${ pack }/*.native.wire` )
			return 1
		}

		const out = $node.path.join( root, pack, '-', 'wire', mode )
		$node.fs.mkdirSync( out, { recursive: true } )
		$node.fs.writeFileSync( $node.path.join( out, 'main.c' ), code )
		for( const file of [ 'rt.c', 'rt.h' ] ) $node.fs.copyFileSync( $node.path.join( root, 'bog/wire/rt', file ), $node.path.join( out, file ) )

		const binary = mode === 'test' ? $node.path.join( out, 'test' ) : $node.path.join( root, pack, '-', 'native' )
		const cc = $node.child_process.spawnSync( 'zig', [ 'cc', '-std=c11', '-O2', '-o', binary, 'main.c', 'rt.c' ], { cwd: out, stdio: 'inherit' } )
		if( cc.status !== 0 ) return cc.status ?? 1

		if( mode === 'test' ) return $node.child_process.spawnSync( binary, [], { stdio: [ 'ignore', 'inherit', 'inherit' ] } ).status ?? 1

		console.log( $node.path.relative( root, binary ) )
		return 0
	}

	if( /bog[\\/]wire[\\/]cli[\\/]-[\\/]node\.js$/.test( $node.process.argv[1] ?? '' ) ) {
		$node.process.exitCode = $bog_wire_cli( $node.process.argv.slice( 2 ) )
	}

}
