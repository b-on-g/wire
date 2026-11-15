#!/bin/zsh
set -e

here=${0:A:h}
root=${here:h:h:h}
out=$here/-
sizes=( ${@:-1000 3000 10000} )
runs=5

mkdir -p $out

( cd $root && node bog/wire/cli/-/node.js build bog/wire/bench > /dev/null )
cargo build --release --quiet --manifest-path $here/rust/Cargo.toml --target-dir $out/rust
( cd $here/go && go build -o $out/go . )
rustc -C opt-level=3 -o $out/plain $here/plain/main.rs
( cd $here/node && npm install --silent > /dev/null )

for n in $sizes; do
	awk -v n=$n 'BEGIN {
		for( i = 0; i < n; ++i ) print "add " i " " i % 5 + 1
		print "print"
		for( i = 0; i < n; ++i ) print "set " i " " i % 5 + 2
		print "print"
		for( i = 0; i < n; ++i ) print "cancel " i
		print "print"
	}' > $out/input$n.txt
done

measure() {
	local name=$1; shift
	for n in $sizes; do
		for i in $(seq $runs); do
			/usr/bin/time -l $@ < $out/input$n.txt 2>&1 > /dev/null | awk -v name=$name -v n=$n '
				/maximum resident/ { mem = $1 }
				/instructions retired/ { ins = $1 }
				END { print n, name, ins, mem }
			'
		done
	done
}

{
	measure wire $here/-/native
	measure rust $out/rust/release/bog_wire_bench
	measure node node $here/node/bench.cjs
	measure go $out/go
	measure plain $out/plain
} > $out/raw.txt

median() {
	sort -n | awk '{ v[ NR ] = $1 } END { print v[ int( ( NR + 1 ) / 2 ) ] }'
}

for n in $sizes; do
	for name in wire rust node go plain; do
		ins=$( awk -v n=$n -v name=$name '$1 == n && $2 == name { print $3 }' $out/raw.txt | median )
		mem=$( awk -v n=$n -v name=$name '$1 == n && $2 == name { print $4 }' $out/raw.txt | median )
		awk -v n=$n -v name=$name -v ins=$ins -v mem=$mem 'BEGIN { printf "%6s  %-5s  %8.3f млрд инструкций  %6.1f МБ\n", n, name, ins / 1e9, mem / 1e6 }'
	done
done
