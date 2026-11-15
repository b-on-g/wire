#[allow(dead_code)]
mod wire {
	include!( "wire_core.rs" );
	include!( "wire_node.rs" );
}

use std::io::Read;
use wire::{ alive, solid, sync, Mem, MemKey, Obj, Root };

#[derive( Clone, Copy )]
struct Line {
	orders: Orders,
	id: u64,
	qty: Mem<i64>,
}

impl Line {
	fn qty( self ) -> i64 {
		let ( orders, id ) = ( self.orders, self.id );
		self.qty.call( None, move |_| orders.order( id, None ) )
	}
}

#[derive( Clone, Copy, Default )]
struct Orders {
	ids: Mem<Vec<u64>>,
	order: MemKey<u64, i64>,
	line: MemKey<u64, Obj<Line>>,
	lines: Mem<Vec<Obj<Line>>>,
	sum: Mem<i64>,
}

impl Orders {
	fn ids( self, next: Option<Vec<u64>> ) -> Vec<u64> {
		self.ids.call( next, |next| {
			solid();
			next.unwrap_or_default()
		} )
	}

	fn order( self, id: u64, next: Option<i64> ) -> i64 {
		self.order.call( &id, next, |_, next| {
			solid();
			next.unwrap_or( 0 )
		} )
	}

	fn line( self, id: u64 ) -> Obj<Line> {
		self.line.call( &id, None, move |&id, _| Obj::make( move || Line { orders: self, id, qty: Mem::default() } ) )
	}

	fn lines( self ) -> Vec<Obj<Line>> {
		self.lines.call( None, move |_| self.ids( None ).into_iter().map( |id| self.line( id ) ).collect() )
	}

	fn sum( self ) -> i64 {
		self.sum.call( None, move |_| self.lines().iter().map( |line| line.qty() ).sum() )
	}

	fn add( self, id: u64, qty: i64 ) {
		let mut ids = self.ids( None );
		ids.push( id );
		self.ids( Some( ids ) );
		self.order( id, Some( qty ) );
	}

	fn set( self, id: u64, qty: i64 ) {
		self.order( id, Some( qty ) );
	}

	fn cancel( self, id: u64 ) {
		let ids = self.ids( None ).into_iter().filter( |one| *one != id ).collect();
		self.ids( Some( ids ) );
		self.order( id, Some( 0 ) );
	}
}

fn main() {
	let mut input = String::new();
	std::io::stdin().read_to_string( &mut input ).unwrap();

	let root = Root::<Orders>::default();
	let shop = **root;

	for said in input.lines() {
		let parts: Vec<&str> = said.split( ' ' ).collect();
		match parts[ 0 ] {
			"add" => shop.add( parts[ 1 ].parse().unwrap(), parts[ 2 ].parse().unwrap() ),
			"set" => shop.set( parts[ 1 ].parse().unwrap(), parts[ 2 ].parse().unwrap() ),
			"cancel" => shop.cancel( parts[ 1 ].parse().unwrap() ),
			"print" => println!( "заказано {} строк {}", shop.sum(), shop.lines().len() ),
			_ => {}
		}
		sync();
	}

	drop( root );
	sync();
	println!( "живых узлов {}", alive() );
}
