const $ = require( 'mol_wire_lib' )
const fs = require( 'fs' )

let lines_alive = 0

class Line extends $.$mol_object2 {
	constructor( orders, id ) { super(); this.orders = orders; this.id = id; ++ lines_alive }
	qty() { return this.orders.order( this.id ) }
	destructor() { -- lines_alive }
}

class Orders extends $.$mol_object2 {
	ids( next ) { $.$mol_wire_solid(); return next ?? [] }
	order( id, next ) { $.$mol_wire_solid(); return next ?? 0 }
	line( id ) { return new Line( this, id ) }
	lines() { return this.ids().map( id => this.line( id ) ) }
	sum() { return this.lines().reduce( ( sum, line ) => sum + line.qty(), 0 ) }
	add( id, qty ) { this.ids( [ ...this.ids(), id ] ); this.order( id, qty ) }
	set( id, qty ) { this.order( id, qty ) }
	cancel( id ) { this.ids( this.ids().filter( one => one !== id ) ); this.order( id, 0 ) }
}

$.$mol_wire_solo( Orders.prototype, 'ids' )
$.$mol_wire_plex( Orders.prototype, 'order' )
$.$mol_wire_plex( Orders.prototype, 'line' )
$.$mol_wire_solo( Orders.prototype, 'lines' )
$.$mol_wire_solo( Orders.prototype, 'sum' )
$.$mol_wire_solo( Line.prototype, 'qty' )

const shop = new Orders
for( const said of fs.readFileSync( 0, 'utf8' ).split( '\n' ) ) {
	const [ head, id, qty ] = said.split( ' ' )
	if( head === 'add' ) shop.add( Number( id ), Number( qty ) )
	if( head === 'set' ) shop.set( Number( id ), Number( qty ) )
	if( head === 'cancel' ) shop.cancel( Number( id ) )
	if( head === 'print' ) console.log( `заказано ${ shop.sum() } строк ${ shop.lines().length }` )
	$.$mol_wire_fiber.sync()
}
console.log( `живых строк ${ lines_alive }` )
