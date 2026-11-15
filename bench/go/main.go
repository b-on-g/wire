package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Signal struct {
	value int
	next  int
	subs  map[int]func(prev, next int)
}

func NewSignal(value int) *Signal {
	return &Signal{value: value, subs: map[int]func(int, int){}}
}

func (s *Signal) Subscribe(fn func(prev, next int)) func() {
	id := s.next
	s.next++
	s.subs[id] = fn
	return func() { delete(s.subs, id) }
}

func (s *Signal) Set(value int) {
	prev := s.value
	if prev == value {
		return
	}
	s.value = value
	for _, fn := range s.subs {
		fn(prev, value)
	}
}

type Line struct {
	unsubscribe func()
}

type Shop struct {
	orders map[int]*Signal
	lines  map[int]*Line
	sum    int
}

func (shop *Shop) Put(id int, qty int) {
	order, ok := shop.orders[id]
	if ok {
		order.Set(qty)
		return
	}
	order = NewSignal(qty)
	shop.orders[id] = order
	shop.sum += qty
	shop.lines[id] = &Line{unsubscribe: order.Subscribe(func(prev, next int) { shop.sum += next - prev })}
}

func (shop *Shop) Cancel(id int) {
	order, ok := shop.orders[id]
	if !ok {
		return
	}
	shop.sum -= order.value
	shop.lines[id].unsubscribe()
	delete(shop.lines, id)
	delete(shop.orders, id)
}

func main() {
	shop := &Shop{orders: map[int]*Signal{}, lines: map[int]*Line{}}
	subs := 0
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		parts := strings.Split(scanner.Text(), " ")
		switch parts[0] {
		case "add", "set":
			qty, _ := strconv.Atoi(parts[2])
			id, _ := strconv.Atoi(parts[1])
			shop.Put(id, qty)
		case "cancel":
			id, _ := strconv.Atoi(parts[1])
			shop.Cancel(id)
		case "print":
			fmt.Printf("заказано %d строк %d\n", shop.sum, len(shop.lines))
		}
	}
	for _, order := range shop.orders {
		subs += len(order.subs)
	}
	fmt.Printf("живых подписок %d\n", subs)
}
