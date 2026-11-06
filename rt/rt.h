#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
	WIRE_VOID,
	WIRE_INT,
	WIRE_FLOAT,
	WIRE_BOOL,
	WIRE_TEXT,
	WIRE_LIST,
	WIRE_MAYBE,
	WIRE_RECORD,
	WIRE_OBJECT,
} wire_kind;

typedef struct wire_type wire_type;

struct wire_type {
	wire_kind kind;
	const wire_type* item;
	int fields;
	const wire_type* const* field_types;
};

typedef struct wire_box {
	int64_t rc;
	const wire_type* type;
} wire_box;

typedef struct wire_obj wire_obj;

typedef union wire_val {
	int64_t i;
	double f;
	bool b;
	wire_box* box;
	wire_obj* obj;
} wire_val;

typedef struct {
	wire_box head;
	int64_t len;
	char bytes[];
} wire_text;

typedef struct {
	wire_box head;
	int64_t len;
	wire_val items[];
} wire_list;

typedef struct {
	wire_box head;
	wire_val fields[];
} wire_record;

typedef struct {
	wire_box head;
	wire_val value;
} wire_some;

typedef struct {
	uint32_t idx;
	uint32_t gen;
} wire_id;

typedef void ( *wire_calc )( wire_obj* self, const wire_val* keys, const wire_val* next, wire_val* out );

typedef void ( *wire_bind )( wire_obj* child, wire_val* out );

typedef void ( *wire_action )( wire_obj* self, const wire_val* args );

typedef struct {
	const char* name;
	const wire_type* type;
	bool solid;
	int keys;
	const wire_type* const* key_types;
	wire_calc calc;
	int slot;
} wire_member;

typedef struct {
	const char* name;
	int atoms;
	int maps;
	int binds;
} wire_class;

typedef struct {
	wire_val* keys;
	wire_id atom;
} wire_entry;

typedef struct {
	wire_entry* items;
	int len;
	int cap;
} wire_map;

struct wire_obj {
	const wire_class* cls;
	wire_id node;
	wire_id* atoms;
	wire_map* maps;
	wire_bind* binds;
	wire_obj* bind_owner;
	wire_val* captured;
	const wire_type* const* captured_types;
	int captured_len;
	bool dead;
};

typedef struct {
	char* data;
	int64_t len;
	int64_t cap;
} wire_buf;

typedef struct {
	const wire_type* type;
	wire_val* items;
	int64_t len;
	int64_t cap;
} wire_list_builder;

extern int64_t wire_live;
extern int wire_failures;

void wire_retain( const wire_type* type, wire_val value );
void wire_release( const wire_type* type, wire_val value );
bool wire_eq( const wire_type* type, wire_val left, wire_val right );

wire_val wire_text_lit( const char* bytes, int64_t len );
wire_val wire_text_cat( wire_val left, wire_val right );
int wire_text_cmp( wire_val left, wire_val right );

void wire_buf_lit( wire_buf* buf, const char* bytes, int64_t len );
void wire_buf_int( wire_buf* buf, int64_t value );
void wire_buf_float( wire_buf* buf, double value );
void wire_buf_bool( wire_buf* buf, bool value );
void wire_buf_text( wire_buf* buf, wire_val text );
wire_val wire_buf_done( wire_buf* buf );

wire_val wire_some_new( const wire_type* type, wire_val inner );

wire_val wire_record_new( const wire_type* type, const wire_val* fields );
wire_val wire_record_get( wire_val record, int index );

void wire_list_begin( wire_list_builder* builder, const wire_type* type );
void wire_list_add( wire_list_builder* builder, wire_val item );
void wire_list_add_all( wire_list_builder* builder, wire_val list );
wire_val wire_list_end( wire_list_builder* builder );

wire_val wire_list_map( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member );
wire_val wire_list_find( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key );
wire_val wire_list_upsert( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key, wire_val value );
wire_val wire_list_drop( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key );
wire_val wire_list_sort( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member );
wire_val wire_list_sum( wire_val list );
int64_t wire_list_size( wire_val list );

wire_obj* wire_obj_new( const wire_class* cls, bool root );
void wire_obj_capture( wire_obj* obj, wire_obj* owner, int len, const wire_type* const* types, const wire_val* values );
void wire_obj_destroy( wire_obj* obj );

wire_val wire_read( wire_obj* obj, const wire_member* member, const wire_val* keys, const wire_val* next );

void wire_sync( void );
int64_t wire_alive( void );

void wire_assert( bool ok, const char* where );
int wire_test( const char* name, const wire_class* cls, wire_action action );
