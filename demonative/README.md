# $bog_wire_demonative

Реактивная таблица в терминале на wire, то же, что `bog/zig/demonative`.

```sh
node bog/build2/start/-/node.js bog/wire/demonative
printf 'PRICE = 120\nQTY = 3\nTOTAL = PRICE * QTY\nQTY = 4\n' | bog/wire/demonative/-/native
```

- `formula` — рекурсивный спуск на мемо по позиции: `expr( pos )`, `term_tail( left )`, `factor_at( pos )`. Циклов и переменных нет, каждый шаг разбора — атом, его результат — запись `num, err, end`. Ссылка на ячейку читает `sheet.value( name )`, поэтому формула пересчитывается, только когда меняется то, что она прочитала.
- `sheet` — стор ячеек (`solid`), формула на каждую ячейку, значения по имени. Цикл ищется по ссылкам из текста формул объектом `search( target, depth )`: замыканий в языке нет, поэтому параметры обхода живут в объекте, а его метод `hop` уходит в `map`.
- `command` — разбор строки `NAME = формула`.
- корень — выполнение команды, `demonative.native.wire` — цикл чтения `stdin( n )`.
