namespace $ {

	export class $bog_wire_source extends $bog_build2_source {

		static match( file: $bog_build2_file ) {
			return /\.wire$/.test( file.name() )
		}

		@ $mol_mem
		deps() {
			const deps = super.deps()

			for( const line of String( this.file().text() ).split( '\n' ) ) {
				const code = line.replace( /"(\\.|[^"\\])*"/g, '""' )
				const priority = this.priority( line )

				for( const [ , name ] of code.matchAll( /\$([a-z][a-z0-9_]*)/gi ) ) {
					this.fqn_add( deps, name, priority )
				}
			}

			return deps
		}

	}

	$bog_build2_root.plugin( $bog_wire_source )

}
