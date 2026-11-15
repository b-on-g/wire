use std::io::Read;

struct Line {
	qty: i64,
}

fn main() {
	let mut input = String::new();
	std::io::stdin().read_to_string( &mut input ).unwrap();

	let mut ids: Vec<u64> = Vec::new();
	let mut order: std::collections::HashMap<u64, i64> = std::collections::HashMap::new();

	for said in input.lines() {
		let parts: Vec<&str> = said.split( ' ' ).collect();
		match parts[ 0 ] {
			"add" => {
				let id = parts[ 1 ].parse().unwrap();
				ids.push( id );
				order.insert( id, parts[ 2 ].parse().unwrap() );
			}
			"set" => { order.insert( parts[ 1 ].parse().unwrap(), parts[ 2 ].parse().unwrap() ); }
			"cancel" => {
				let id: u64 = parts[ 1 ].parse().unwrap();
				ids.retain( |one| *one != id );
				order.insert( id, 0 );
			}
			"print" => {
				let lines: Vec<Line> = ids.iter().map( |id| Line { qty: order[ id ] } ).collect();
				let sum: i64 = lines.iter().map( |line| line.qty ).sum();
				println!( "заказано {} строк {}", sum, lines.len() );
			}
			_ => {}
		}
	}
}
