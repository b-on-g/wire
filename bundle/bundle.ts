namespace $ {

	export class $bog_wire_bundle extends $bog_build2_bundle {

		@ $mol_mem_key
		slice_artifacts( slice: $bog_build2_package_slice ) {
			if( slice.prefix() !== 'node' ) return []
			const test = slice.pack().slice( this.$.$bog_build2_package_slice_node_test )
			return [ ... this.native( slice ), ... this.test( test ) ]
		}

		program( slice: $bog_build2_package_slice, mode: 'test' | 'native' ) {
			const root = this.root().dir()
			const modules = [ ... slice.files() ]
				.filter( file => /\.wire$/.test( file.name() ) )
				.map( file => $bog_wire_parse( file.text(), file.relate( root ) ) )

			if( !modules.length ) return null

			const check = new $bog_wire_check( modules )
			if( check.errors.length ) {
				$mol_fail( new $mol_error_mix( `wire: ${ check.errors.length } errors`, {}, ... check.errors ) )
			}

			const code = new $bog_wire_emit( check ).program( mode )
			return /\nint main\(/.test( code ) ? code : null
		}

		compile( slice: $bog_build2_package_slice, mode: 'test' | 'native', target: $bog_build2_file ) {
			const code = this.program( slice, mode )
			if( !code ) return null

			const out = slice.pack().output().resolve( `wire/${ mode }` )
			const rt = this.root().dir().resolve( 'bog/wire/rt' )

			out.resolve( 'main.c' ).text( code )
			out.resolve( 'rt.c' ).text( rt.resolve( 'rt.c' ).text() )
			out.resolve( 'rt.h' ).text( rt.resolve( 'rt.h' ).text() )

			this.run( out, [ 'zig', 'cc', '-std=c11', mode === 'test' ? '-O1' : '-O2', '-o', target.path(), 'main.c', 'rt.c' ] )
			return out.resolve( 'main.c' )
		}

		native( slice: $bog_build2_package_slice ) {
			const start = Date.now()
			const target = slice.pack().output().resolve( 'native' )
			const source = this.compile( slice, 'native', target )
			if( !source ) return []
			this.log( target, Date.now() - start )
			return [ source, target ]
		}

		test( slice: $bog_build2_package_slice ) {
			const start = Date.now()
			const target = slice.pack().output().resolve( 'wire/test/test' )
			const source = this.compile( slice, 'test', target )
			if( !source ) return []
			this.run( target.parent(), [ './test' ] )
			this.log( target, Date.now() - start )
			return [ source, target ]
		}

		run( dir: $bog_build2_file, command: string[] ) {
			this.$.$bog_build2_file.unwatched( ()=> this.$.$mol_run.spawn({ command, dir: dir.path() }), dir.path() )
		}

	}

	$bog_build2_root.plugin( $bog_wire_bundle )

}
