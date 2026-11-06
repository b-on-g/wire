namespace $ {

	export class $bog_wire_bundle extends $bog_build2_bundle {

		@ $mol_mem_key
		slice_artifacts( slice: $bog_build2_package_slice ) {
			if( slice.prefix() !== 'node' ) return []
			return this.test( slice.pack().slice( this.$.$bog_build2_package_slice_node_test ) )
		}

		program( slice: $bog_build2_package_slice ) {
			const root = this.root().dir()
			const modules = [ ... slice.files() ]
				.filter( file => /\.wire$/.test( file.name() ) )
				.map( file => $bog_wire_parse( file.text(), file.relate( root ) ) )

			if( !modules.length ) return null

			const check = new $bog_wire_check( modules )
			if( check.errors.length ) {
				$mol_fail( new $mol_error_mix( `wire: ${ check.errors.length } errors`, {}, ... check.errors ) )
			}

			return new $bog_wire_emit( check ).program()
		}

		test( slice: $bog_build2_package_slice ) {
			const code = this.program( slice )
			if( !code || !/\nint main\(/.test( code ) ) return []

			const start = Date.now()
			const out = slice.pack().output().resolve( 'wire' )
			const rt = this.root().dir().resolve( 'bog/wire/rt' )

			const source = out.resolve( 'test.c' )
			source.text( code )
			out.resolve( 'rt.c' ).text( rt.resolve( 'rt.c' ).text() )
			out.resolve( 'rt.h' ).text( rt.resolve( 'rt.h' ).text() )

			this.run( out, [ 'zig', 'cc', '-std=c11', '-O1', '-o', 'test', 'test.c', 'rt.c' ] )
			this.run( out, [ './test' ] )

			const binary = out.resolve( 'test' )
			this.log( binary, Date.now() - start )

			return [ source, binary ]
		}

		run( dir: $bog_build2_file, command: string[] ) {
			this.$.$bog_build2_file.unwatched( ()=> this.$.$mol_run.spawn({ command, dir: dir.path() }), dir.path() )
		}

	}

	$bog_build2_root.plugin( $bog_wire_bundle )

}
