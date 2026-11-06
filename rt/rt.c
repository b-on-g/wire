#include "rt.h"

#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int64_t wire_live = 0;
int wire_failures = 0;

static const wire_type text_type = { WIRE_TEXT, NULL, 0, NULL };
static const wire_type int_type = { WIRE_INT, NULL, 0, NULL };
static const wire_type maybe_text_type = { WIRE_MAYBE, &text_type, 0, NULL };

static void fail( const char* message ) {
	fflush( stdout );
	fprintf( stderr, "$bog_wire: %s\n", message );
	abort();
}

static void* grow( void* data, size_t size ) {
	void* next = realloc( data, size );
	if( !next && size ) fail( "out of memory" );
	return next;
}

static void* box_alloc( size_t size ) {
	void* box = calloc( 1, size );
	if( !box ) fail( "out of memory" );
	wire_live += 1;
	return box;
}

static void box_free( void* box ) {
	wire_live -= 1;
	free( box );
}

static bool boxed( const wire_type* type ) {
	switch( type->kind ) {
		case WIRE_TEXT:
		case WIRE_LIST:
		case WIRE_MAYBE:
		case WIRE_RECORD:
			return true;
		default:
			return false;
	}
}

void wire_retain( const wire_type* type, wire_val value ) {
	if( boxed( type ) && value.box ) value.box->rc += 1;
}

void wire_release( const wire_type* type, wire_val value ) {
	if( !boxed( type ) || !value.box ) return;
	if( --value.box->rc > 0 ) return;

	const wire_type* own = value.box->type;

	switch( own->kind ) {

		case WIRE_LIST: {
			wire_list* list = ( wire_list* ) value.box;
			for( int64_t i = 0; i < list->len; ++i ) wire_release( own->item, list->items[ i ] );
			break;
		}

		case WIRE_MAYBE: {
			wire_some* some = ( wire_some* ) value.box;
			wire_release( own->item, some->value );
			break;
		}

		case WIRE_RECORD: {
			wire_record* record = ( wire_record* ) value.box;
			for( int i = 0; i < own->fields; ++i ) wire_release( own->field_types[ i ], record->fields[ i ] );
			break;
		}

		default:
			break;
	}

	box_free( value.box );
}

typedef struct {
	const wire_type* type;
	wire_val value;
	void* raw;
} wire_held;

static struct {
	wire_held* items;
	int len;
	int cap;
} scope;

static int hold( const wire_type* type, wire_val value, void* raw ) {
	if( scope.len == scope.cap ) {
		scope.cap = scope.cap * 2 + 64;
		scope.items = grow( scope.items, sizeof( wire_held ) * scope.cap );
	}
	scope.items[ scope.len ] = ( wire_held ){ type, value, raw };
	return scope.len++;
}

static void scope_end( int mark ) {
	while( scope.len > mark ) {
		wire_held held = scope.items[ --scope.len ];
		if( held.raw ) free( held.raw );
		else wire_release( held.type, held.value );
	}
}

wire_val wire_keep( const wire_type* type, wire_val value ) {
	if( boxed( type ) && value.box ) hold( type, value, NULL );
	return value;
}

bool wire_eq( const wire_type* type, wire_val left, wire_val right ) {
	switch( type->kind ) {

		case WIRE_VOID: return true;
		case WIRE_INT: return left.i == right.i;
		case WIRE_FLOAT: return left.f == right.f;
		case WIRE_BOOL: return left.b == right.b;
		case WIRE_OBJECT: return left.obj == right.obj;

		case WIRE_TEXT: {
			if( left.box == right.box ) return true;
			wire_text* a = ( wire_text* ) left.box;
			wire_text* b = ( wire_text* ) right.box;
			return a->len == b->len && memcmp( a->bytes, b->bytes, a->len ) == 0;
		}

		case WIRE_LIST: {
			if( left.box == right.box ) return true;
			wire_list* a = ( wire_list* ) left.box;
			wire_list* b = ( wire_list* ) right.box;
			if( a->len != b->len ) return false;
			for( int64_t i = 0; i < a->len; ++i ) {
				if( !wire_eq( type->item, a->items[ i ], b->items[ i ] ) ) return false;
			}
			return true;
		}

		case WIRE_MAYBE: {
			if( left.box == right.box ) return true;
			if( !left.box || !right.box ) return false;
			return wire_eq( type->item, ( ( wire_some* ) left.box )->value, ( ( wire_some* ) right.box )->value );
		}

		case WIRE_RECORD: {
			if( left.box == right.box ) return true;
			wire_record* a = ( wire_record* ) left.box;
			wire_record* b = ( wire_record* ) right.box;
			for( int i = 0; i < type->fields; ++i ) {
				if( !wire_eq( type->field_types[ i ], a->fields[ i ], b->fields[ i ] ) ) return false;
			}
			return true;
		}

	}

	return false;
}

static wire_text* text_new( int64_t len ) {
	wire_text* text = box_alloc( sizeof( wire_text ) + len + 1 );
	text->head.rc = 1;
	text->head.type = &text_type;
	text->len = len;
	return text;
}

static wire_val text_raw( const char* bytes, int64_t len ) {
	wire_text* text = text_new( len );
	memcpy( text->bytes, bytes, len );
	return ( wire_val ){ .box = &text->head };
}

wire_val wire_text_lit( const char* bytes, int64_t len ) {
	return wire_keep( &text_type, text_raw( bytes, len ) );
}

wire_val wire_text_cat( wire_val left, wire_val right ) {
	wire_text* a = ( wire_text* ) left.box;
	wire_text* b = ( wire_text* ) right.box;
	wire_text* text = text_new( a->len + b->len );
	memcpy( text->bytes, a->bytes, a->len );
	memcpy( text->bytes + a->len, b->bytes, b->len );
	return wire_keep( &text_type, ( wire_val ){ .box = &text->head } );
}

int wire_text_cmp( wire_val left, wire_val right ) {
	wire_text* a = ( wire_text* ) left.box;
	wire_text* b = ( wire_text* ) right.box;
	int64_t len = a->len < b->len ? a->len : b->len;
	int order = memcmp( a->bytes, b->bytes, len );
	if( order ) return order;
	return a->len < b->len ? -1 : a->len > b->len ? 1 : 0;
}

void wire_buf_lit( wire_buf* buf, const char* bytes, int64_t len ) {
	if( buf->len + len > buf->cap ) {
		buf->cap = ( buf->len + len ) * 2 + 16;
		buf->data = grow( buf->data, buf->cap );
	}
	memcpy( buf->data + buf->len, bytes, len );
	buf->len += len;
}

void wire_buf_int( wire_buf* buf, int64_t value ) {
	char chunk[ 32 ];
	int len = snprintf( chunk, sizeof chunk, "%lld", ( long long ) value );
	wire_buf_lit( buf, chunk, len );
}

void wire_buf_float( wire_buf* buf, double value ) {
	char chunk[ 64 ];
	int len = snprintf( chunk, sizeof chunk, "%g", value );
	wire_buf_lit( buf, chunk, len );
}

void wire_buf_bool( wire_buf* buf, bool value ) {
	if( value ) wire_buf_lit( buf, "true", 4 );
	else wire_buf_lit( buf, "false", 5 );
}

void wire_buf_text( wire_buf* buf, wire_val text ) {
	wire_text* own = ( wire_text* ) text.box;
	wire_buf_lit( buf, own->bytes, own->len );
}

wire_val wire_buf_done( wire_buf* buf ) {
	wire_val text = wire_text_lit( buf->data ? buf->data : "", buf->len );
	free( buf->data );
	*buf = ( wire_buf ){ 0 };
	return text;
}

wire_val wire_some_new( const wire_type* type, wire_val inner ) {
	wire_retain( type->item, inner );
	wire_some* some = box_alloc( sizeof( wire_some ) );
	some->head.rc = 1;
	some->head.type = type;
	some->value = inner;
	return wire_keep( type, ( wire_val ){ .box = &some->head } );
}

wire_val wire_record_new( const wire_type* type, const wire_val* fields ) {
	wire_record* record = box_alloc( sizeof( wire_record ) + sizeof( wire_val ) * type->fields );
	record->head.rc = 1;
	record->head.type = type;
	for( int i = 0; i < type->fields; ++i ) {
		wire_retain( type->field_types[ i ], fields[ i ] );
		record->fields[ i ] = fields[ i ];
	}
	return wire_keep( type, ( wire_val ){ .box = &record->head } );
}

wire_val wire_record_get( wire_val record, int index ) {
	wire_record* own = ( wire_record* ) record.box;
	return own->fields[ index ];
}

void wire_list_begin( wire_list_builder* builder, const wire_type* type ) {
	wire_list* list = box_alloc( sizeof( wire_list ) + sizeof( wire_val ) * 4 );
	list->head.rc = 1;
	list->head.type = type;
	*builder = ( wire_list_builder ){ type, hold( type, ( wire_val ){ .box = &list->head }, NULL ), 4 };
}

void wire_list_add( wire_list_builder* builder, wire_val item ) {
	wire_list* list = ( wire_list* ) scope.items[ builder->slot ].value.box;
	if( list->len == builder->cap ) {
		builder->cap = builder->cap * 2;
		list = grow( list, sizeof( wire_list ) + sizeof( wire_val ) * builder->cap );
		scope.items[ builder->slot ].value.box = &list->head;
	}
	wire_retain( builder->type->item, item );
	list->items[ list->len++ ] = item;
}

void wire_list_add_all( wire_list_builder* builder, wire_val list ) {
	wire_list* own = ( wire_list* ) list.box;
	for( int64_t i = 0; i < own->len; ++i ) wire_list_add( builder, own->items[ i ] );
}

wire_val wire_list_end( wire_list_builder* builder ) {
	return scope.items[ builder->slot ].value;
}

static wire_val key_of( wire_obj* owner, const wire_member* member, wire_val item ) {
	return wire_read( owner, member, &item, NULL );
}

wire_val wire_list_map( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member ) {
	wire_list* own = ( wire_list* ) list.box;
	wire_list_builder builder;
	wire_list_begin( &builder, type );
	for( int64_t i = 0; i < own->len; ++i ) wire_list_add( &builder, key_of( owner, member, own->items[ i ] ) );
	return wire_list_end( &builder );
}

static bool key_match( wire_obj* owner, const wire_member* member, wire_val item, wire_val key ) {
	return wire_eq( member->type, key_of( owner, member, item ), key );
}

wire_val wire_list_find( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key ) {
	wire_list* own = ( wire_list* ) list.box;
	const wire_type* item = type->item;

	for( int64_t i = 0; i < own->len; ++i ) {
		if( !key_match( owner, member, own->items[ i ], key ) ) continue;
		if( item->kind == WIRE_MAYBE ) return own->items[ i ];
		return wire_some_new( type, own->items[ i ] );
	}

	return ( wire_val ){ .box = NULL };
}

wire_val wire_list_upsert( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key, wire_val value ) {
	wire_list* own = ( wire_list* ) list.box;
	wire_list_builder builder;
	wire_list_begin( &builder, type );
	bool found = false;

	for( int64_t i = 0; i < own->len; ++i ) {
		wire_val item = own->items[ i ];
		if( !found && key_match( owner, member, item, key ) ) {
			found = true;
			item = value;
		}
		wire_list_add( &builder, item );
	}

	if( !found ) wire_list_add( &builder, value );

	return wire_list_end( &builder );
}

wire_val wire_list_drop( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member, wire_val key ) {
	wire_list* own = ( wire_list* ) list.box;
	wire_list_builder builder;
	wire_list_begin( &builder, type );

	for( int64_t i = 0; i < own->len; ++i ) {
		if( key_match( owner, member, own->items[ i ], key ) ) continue;
		wire_list_add( &builder, own->items[ i ] );
	}

	return wire_list_end( &builder );
}

static int key_cmp( const wire_type* type, wire_val left, wire_val right ) {
	switch( type->kind ) {
		case WIRE_INT: return left.i < right.i ? -1 : left.i > right.i;
		case WIRE_FLOAT: return left.f < right.f ? -1 : left.f > right.f;
		case WIRE_TEXT: return wire_text_cmp( left, right );
		default: fail( "unsortable key" );
	}
	return 0;
}

wire_val wire_list_sort( const wire_type* type, wire_val list, wire_obj* owner, const wire_member* member ) {
	wire_list* own = ( wire_list* ) list.box;
	int64_t len = own->len;
	wire_val* keys = grow( NULL, sizeof( wire_val ) * ( len + 1 ) );
	int64_t* order = grow( NULL, sizeof( int64_t ) * ( len + 1 ) );
	hold( NULL, ( wire_val ){ 0 }, keys );
	hold( NULL, ( wire_val ){ 0 }, order );

	for( int64_t i = 0; i < len; ++i ) {
		keys[ i ] = key_of( owner, member, own->items[ i ] );
		order[ i ] = i;
	}

	for( int64_t i = 1; i < len; ++i ) {
		int64_t current = order[ i ];
		int64_t j = i;
		while( j > 0 && key_cmp( member->type, keys[ order[ j - 1 ] ], keys[ current ] ) > 0 ) {
			order[ j ] = order[ j - 1 ];
			j -= 1;
		}
		order[ j ] = current;
	}

	wire_list_builder builder;
	wire_list_begin( &builder, type );
	for( int64_t i = 0; i < len; ++i ) wire_list_add( &builder, own->items[ order[ i ] ] );

	return wire_list_end( &builder );
}

wire_val wire_list_sum( wire_val list ) {
	wire_list* own = ( wire_list* ) list.box;
	if( own->head.type->item->kind == WIRE_FLOAT ) {
		double sum = 0;
		for( int64_t i = 0; i < own->len; ++i ) sum += own->items[ i ].f;
		return ( wire_val ){ .f = sum };
	}
	int64_t sum = 0;
	for( int64_t i = 0; i < own->len; ++i ) sum += own->items[ i ].i;
	return ( wire_val ){ .i = sum };
}

int64_t wire_list_size( wire_val list ) {
	return ( ( wire_list* ) list.box )->len;
}

wire_val wire_list_join( wire_val list, wire_val separator ) {
	wire_list* own = ( wire_list* ) list.box;
	wire_buf buf = { 0 };
	for( int64_t i = 0; i < own->len; ++i ) {
		if( i ) wire_buf_text( &buf, separator );
		wire_buf_text( &buf, own->items[ i ] );
	}
	return wire_buf_done( &buf );
}

typedef enum { FRESH, DOUBT, STALE } wire_state;

typedef enum { NODE_ATOM, NODE_OBJ } wire_node_kind;

typedef struct {
	wire_id* items;
	int len;
	int cap;
} wire_ids;

typedef struct {
	uint32_t gen;
	bool alive;
	wire_node_kind kind;
	wire_state state;
	bool busy;
	bool solid;
	bool root;
	bool waiting;
	bool has_owner;
	wire_id owner;
	wire_ids kids;
	wire_ids pubs;
	wire_ids subs;
	wire_obj* obj;
	const wire_member* member;
	wire_val* keys;
	int map;
	bool has_value;
	wire_val value;
} wire_node;

typedef struct wire_frame {
	jmp_buf jump;
	struct wire_frame* prev;
} wire_frame;

static const wire_id none = { UINT32_MAX, 0 };

static struct {
	wire_node* nodes;
	uint32_t len;
	uint32_t cap;
	uint32_t* free;
	uint32_t free_len;
	uint32_t free_cap;
	wire_id current;
	wire_frame* frame;
	int effect_index;
	int effect_done;
	wire_ids touched;
	wire_ids orphans;
	wire_obj** garbage;
	int garbage_len;
	int garbage_cap;
} rt = { .current = { UINT32_MAX, 0 } };

static bool same( wire_id left, wire_id right ) {
	return left.idx == right.idx && left.gen == right.gen;
}

static wire_node* get( wire_id id ) {
	if( id.idx >= rt.len ) return NULL;
	wire_node* node = &rt.nodes[ id.idx ];
	if( !node->alive || node->gen != id.gen ) return NULL;
	return node;
}

static wire_node* node_of( wire_id id ) {
	wire_node* node = get( id );
	if( !node ) fail( "access to destroyed node" );
	return node;
}

static void ids_push( wire_ids* ids, wire_id id ) {
	if( ids->len == ids->cap ) {
		ids->cap = ids->cap * 2 + 4;
		ids->items = grow( ids->items, sizeof( wire_id ) * ids->cap );
	}
	ids->items[ ids->len++ ] = id;
}

static bool ids_has( wire_ids* ids, wire_id id ) {
	for( int i = 0; i < ids->len; ++i ) if( same( ids->items[ i ], id ) ) return true;
	return false;
}

static void ids_drop( wire_ids* ids, wire_id id ) {
	int keep = 0;
	for( int i = 0; i < ids->len; ++i ) {
		if( !same( ids->items[ i ], id ) ) ids->items[ keep++ ] = ids->items[ i ];
	}
	ids->len = keep;
}

static wire_ids ids_take( wire_ids* ids ) {
	wire_ids taken = *ids;
	*ids = ( wire_ids ){ 0 };
	return taken;
}

static void ids_free( wire_ids* ids ) {
	free( ids->items );
	*ids = ( wire_ids ){ 0 };
}

static void touch( wire_id id ) {
	ids_push( &rt.touched, id );
}

static void orphan( wire_id id ) {
	ids_push( &rt.orphans, id );
}

static wire_id alloc( wire_node_kind kind, const wire_id* owner, bool root ) {
	uint32_t idx;

	if( rt.free_len ) {
		idx = rt.free[ --rt.free_len ];
	} else {
		if( rt.len == rt.cap ) {
			rt.cap = rt.cap * 2 + 64;
			rt.nodes = grow( rt.nodes, sizeof( wire_node ) * rt.cap );
		}
		idx = rt.len++;
		rt.nodes[ idx ].gen = 0;
	}

	uint32_t gen = rt.nodes[ idx ].gen;
	rt.nodes[ idx ] = ( wire_node ){ .gen = gen, .alive = true, .kind = kind, .state = STALE, .root = root, .map = -1 };
	wire_id id = { idx, gen };

	if( owner && get( *owner ) ) {
		rt.nodes[ idx ].has_owner = true;
		rt.nodes[ idx ].owner = *owner;
		ids_push( &node_of( *owner )->kids, id );
	} else if( !root ) {
		orphan( id );
	}

	return id;
}

static void track( wire_id dep ) {
	if( !get( rt.current ) ) return;
	wire_id sub = rt.current;
	if( same( sub, dep ) ) return;
	if( !ids_has( &node_of( sub )->pubs, dep ) ) ids_push( &node_of( sub )->pubs, dep );
	if( !ids_has( &node_of( dep )->subs, sub ) ) ids_push( &node_of( dep )->subs, sub );
}

static void mark( wire_id start, wire_state state ) {
	wire_ids stack = { 0 };
	wire_ids states = { 0 };
	ids_push( &stack, start );
	ids_push( &states, ( wire_id ){ state, 0 } );

	while( stack.len ) {
		wire_id id = stack.items[ --stack.len ];
		wire_state next = ( wire_state ) states.items[ --states.len ].idx;
		wire_node* node = get( id );
		if( !node ) continue;
		wire_state was = node->state;
		if( was >= next ) continue;
		node->state = next;
		if( was != FRESH ) continue;
		for( int i = 0; i < node->subs.len; ++i ) {
			ids_push( &stack, node->subs.items[ i ] );
			ids_push( &states, ( wire_id ){ DOUBT, 0 } );
		}
	}

	ids_free( &stack );
	ids_free( &states );
}

static void unlink_pubs( wire_id id ) {
	wire_ids pubs = ids_take( &node_of( id )->pubs );
	for( int i = 0; i < pubs.len; ++i ) {
		wire_node* dep = get( pubs.items[ i ] );
		if( !dep ) continue;
		ids_drop( &dep->subs, id );
		if( !dep->subs.len ) touch( pubs.items[ i ] );
	}
	ids_free( &pubs );
}

static void adopt( wire_id owner, wire_id kid ) {
	wire_node* node = get( kid );
	if( !node || node->has_owner || node->root ) return;
	node->has_owner = true;
	node->owner = owner;
	ids_push( &node_of( owner )->kids, kid );
}

static void destroy( wire_id id );

static void release_kids( wire_id id, const wire_id* keep ) {
	wire_ids kids = ids_take( &node_of( id )->kids );
	for( int i = 0; i < kids.len; ++i ) {
		if( keep && same( *keep, kids.items[ i ] ) ) ids_push( &node_of( id )->kids, kids.items[ i ] );
		else destroy( kids.items[ i ] );
	}
	ids_free( &kids );
}

static void map_remove( wire_obj* obj, int map, wire_id atom ) {
	wire_map* own = &obj->maps[ map ];
	for( int i = 0; i < own->len; ++i ) {
		if( !same( own->items[ i ].atom, atom ) ) continue;
		own->items[ i ] = own->items[ --own->len ];
		return;
	}
}

static void destroy( wire_id id ) {
	wire_node* node = get( id );
	if( !node ) return;

	node->alive = false;
	node->gen += 1;

	wire_node_kind kind = node->kind;
	bool has_owner = node->has_owner;
	wire_id owner = node->owner;
	wire_ids kids = ids_take( &node->kids );
	wire_ids pubs = ids_take( &node->pubs );
	wire_ids subs = ids_take( &node->subs );
	wire_obj* obj = node->obj;
	const wire_member* member = node->member;
	wire_val* keys = node->keys;
	int map = node->map;
	bool has_value = node->has_value;
	wire_val value = node->value;

	if( rt.free_len == rt.free_cap ) {
		rt.free_cap = rt.free_cap * 2 + 64;
		rt.free = grow( rt.free, sizeof( uint32_t ) * rt.free_cap );
	}
	rt.free[ rt.free_len++ ] = id.idx;

	if( has_owner ) {
		wire_node* host = get( owner );
		if( host ) ids_drop( &host->kids, id );
	}

	for( int i = 0; i < pubs.len; ++i ) {
		wire_node* dep = get( pubs.items[ i ] );
		if( !dep ) continue;
		ids_drop( &dep->subs, id );
		if( !dep->subs.len ) touch( pubs.items[ i ] );
	}

	for( int i = 0; i < subs.len; ++i ) {
		wire_node* sub = get( subs.items[ i ] );
		if( sub ) ids_drop( &sub->pubs, id );
		mark( subs.items[ i ], STALE );
	}

	for( int i = 0; i < kids.len; ++i ) destroy( kids.items[ i ] );

	if( kind == NODE_ATOM ) {
		if( has_value ) wire_release( member->type, value );
		if( keys ) {
			map_remove( obj, map, id );
			for( int i = 0; i < member->keys; ++i ) wire_release( member->key_types[ i ], keys[ i ] );
			free( keys );
		}
	} else {
		obj->dead = true;
		for( int i = 0; i < obj->captured_len; ++i ) wire_release( obj->captured_types[ i ], obj->captured[ i ] );
		free( obj->captured );
		for( int i = 0; i < obj->cls->maps; ++i ) free( obj->maps[ i ].items );
		free( obj->maps );
		free( obj->atoms );
		free( obj->binds );
		if( rt.garbage_len == rt.garbage_cap ) {
			rt.garbage_cap = rt.garbage_cap * 2 + 16;
			rt.garbage = grow( rt.garbage, sizeof( wire_obj* ) * rt.garbage_cap );
		}
		rt.garbage[ rt.garbage_len++ ] = obj;
	}

	ids_free( &kids );
	ids_free( &pubs );
	ids_free( &subs );
}

static void evict( wire_id id ) {
	wire_node* node = get( id );
	if( !node || node->kind != NODE_ATOM || node->root || node->solid || node->busy || node->subs.len ) return;

	if( node->keys ) {
		destroy( id );
		return;
	}

	unlink_pubs( id );
	release_kids( id, NULL );

	node = node_of( id );
	node->state = STALE;
	node->waiting = false;
	if( node->has_value ) wire_release( node->member->type, node->value );
	node->has_value = false;
}

static void reap( void ) {
	while( rt.touched.len || rt.orphans.len ) {
		wire_ids touched = ids_take( &rt.touched );
		for( int i = 0; i < touched.len; ++i ) evict( touched.items[ i ] );
		ids_free( &touched );

		wire_ids orphans = ids_take( &rt.orphans );
		for( int i = 0; i < orphans.len; ++i ) {
			wire_node* node = get( orphans.items[ i ] );
			if( node && !node->has_owner && !node->root ) destroy( orphans.items[ i ] );
		}
		ids_free( &orphans );
	}
}

static bool owning( const wire_type* type, wire_val value, wire_id* kid ) {
	if( type->kind == WIRE_OBJECT && value.obj ) {
		*kid = value.obj->node;
		return true;
	}
	if( type->kind == WIRE_MAYBE && type->item->kind == WIRE_OBJECT && value.box ) {
		*kid = ( ( wire_some* ) value.box )->value.obj->node;
		return true;
	}
	return false;
}

void wire_wait( void ) {
	if( !rt.frame ) fail( "wait outside of task" );
	longjmp( rt.frame->jump, 1 );
}

static void calc( wire_id id, const wire_val* next ) {
	wire_node* node = node_of( id );
	wire_obj* obj = node->obj;
	const wire_member* member = node->member;
	const wire_val* keys = node->keys;
	bool put = next != NULL;

	unlink_pubs( id );
	node_of( id )->busy = true;

	wire_id current = rt.current;
	rt.current = put ? none : id;

	int mark_scope = scope.len;
	wire_frame frame;
	frame.prev = rt.frame;
	rt.frame = &frame;

	if( setjmp( frame.jump ) ) {
		rt.frame = frame.prev;
		rt.current = current;
		scope_end( mark_scope );
		node = node_of( id );
		node->busy = false;
		node->state = FRESH;
		node->waiting = true;
		return;
	}

	wire_val out;
	member->calc( obj, keys, next, &out );

	rt.frame = frame.prev;
	rt.current = current;

	wire_id kid;
	bool has_kid = owning( member->type, out, &kid );
	if( has_kid ) adopt( id, kid );
	release_kids( id, has_kid ? &kid : NULL );

	node = node_of( id );
	node->busy = false;
	node->state = FRESH;
	node->waiting = false;

	bool changed = !node->has_value || !wire_eq( member->type, node->value, out );

	if( changed ) {
		wire_retain( member->type, out );
		if( node->has_value ) wire_release( member->type, node->value );
		node->value = out;
		node->has_value = true;
	}

	scope_end( mark_scope );

	if( changed ) {
		node = node_of( id );
		wire_ids subs = { 0 };
		for( int i = 0; i < node->subs.len; ++i ) ids_push( &subs, node->subs.items[ i ] );
		for( int i = 0; i < subs.len; ++i ) mark( subs.items[ i ], STALE );
		ids_free( &subs );
	}

	if( !put ) touch( id );
}

static void refresh( wire_id id ) {
	wire_node* node = get( id );
	if( !node ) return;
	if( node->busy ) fail( "cyclic dependency" );

	if( node->state == DOUBT ) {
		wire_ids pubs = { 0 };
		for( int i = 0; i < node->pubs.len; ++i ) ids_push( &pubs, node->pubs.items[ i ] );
		for( int i = 0; i < pubs.len; ++i ) {
			refresh( pubs.items[ i ] );
			wire_node* dep = get( pubs.items[ i ] );
			wire_node* now = get( id );
			if( !now ) break;
			if( dep && dep->waiting ) now->state = STALE;
			if( now->state != DOUBT ) break;
		}
		ids_free( &pubs );
		node = get( id );
		if( !node ) return;
		if( node->state == DOUBT ) node->state = FRESH;
	}

	if( node->state == STALE ) calc( id, NULL );
}

wire_obj* wire_obj_new( const wire_class* cls, bool root ) {
	wire_obj* obj = box_alloc( sizeof( wire_obj ) );
	obj->cls = cls;
	obj->atoms = grow( NULL, sizeof( wire_id ) * ( cls->atoms + 1 ) );
	for( int i = 0; i < cls->atoms; ++i ) obj->atoms[ i ] = none;
	obj->maps = calloc( cls->maps + 1, sizeof( wire_map ) );
	obj->binds = calloc( cls->binds + 1, sizeof( wire_bind ) );
	obj->node = alloc( NODE_OBJ, NULL, root );
	node_of( obj->node )->obj = obj;
	return obj;
}

void wire_obj_capture( wire_obj* obj, wire_obj* owner, int len, const wire_type* const* types, const wire_val* values ) {
	obj->bind_owner = owner;
	obj->captured_len = len;
	obj->captured_types = types;
	obj->captured = grow( NULL, sizeof( wire_val ) * ( len + 1 ) );
	for( int i = 0; i < len; ++i ) {
		obj->captured[ i ] = values[ i ];
		wire_retain( types[ i ], values[ i ] );
	}
}

void wire_obj_destroy( wire_obj* obj ) {
	destroy( obj->node );
}

static bool keys_eq( const wire_member* member, const wire_val* left, const wire_val* right ) {
	for( int i = 0; i < member->keys; ++i ) {
		if( !wire_eq( member->key_types[ i ], left[ i ], right[ i ] ) ) return false;
	}
	return true;
}

wire_val wire_read( wire_obj* obj, const wire_member* member, const wire_val* keys, const wire_val* next ) {
	if( obj->dead ) fail( "access to destroyed object" );

	wire_id id = none;
	wire_id owner = obj->node;

	if( member->keys ) {
		wire_map* map = &obj->maps[ member->slot ];
		for( int i = 0; i < map->len; ++i ) {
			if( keys_eq( member, map->items[ i ].keys, keys ) ) {
				id = map->items[ i ].atom;
				break;
			}
		}
		if( !get( id ) ) {
			id = alloc( NODE_ATOM, &owner, false );
			wire_val* copy = grow( NULL, sizeof( wire_val ) * member->keys );
			for( int i = 0; i < member->keys; ++i ) {
				copy[ i ] = keys[ i ];
				wire_retain( member->key_types[ i ], copy[ i ] );
			}
			wire_node* node = node_of( id );
			node->obj = obj;
			node->member = member;
			node->keys = copy;
			node->map = member->slot;
			node->solid = member->solid;
			if( map->len == map->cap ) {
				map->cap = map->cap * 2 + 4;
				map->items = grow( map->items, sizeof( wire_entry ) * map->cap );
			}
			map->items[ map->len++ ] = ( wire_entry ){ copy, id };
		}
	} else {
		id = obj->atoms[ member->slot ];
		if( !get( id ) ) {
			id = alloc( NODE_ATOM, &owner, false );
			obj->atoms[ member->slot ] = id;
			wire_node* node = node_of( id );
			node->obj = obj;
			node->member = member;
			node->solid = member->solid;
		}
	}

	if( next ) {
		calc( id, next );
	} else {
		track( id );
		refresh( id );
	}

	wire_node* node = node_of( id );
	if( node->waiting ) wire_wait();

	wire_retain( member->type, node->value );
	return wire_keep( member->type, node->value );
}

static struct {
	wire_val* lines;
	int64_t len;
	int64_t cap;
	bool eof;
	wire_ids waiters;
	wire_obj* obj;
} input;

static void stdin_calc( wire_obj* self, const wire_val* keys, const wire_val* next, wire_val* out ) {
	( void ) self;
	( void ) next;
	int64_t index = keys[ 0 ].i;

	if( index >= 0 && index < input.len ) {
		*out = wire_some_new( &maybe_text_type, input.lines[ index ] );
		return;
	}

	if( index < 0 || input.eof ) {
		*out = ( wire_val ){ .box = NULL };
		return;
	}

	ids_push( &input.waiters, rt.current );
	wire_wait();
}

static const wire_type* const stdin_keys[] = { &int_type };
static const wire_member stdin_member = { "stdin", &maybe_text_type, false, 1, stdin_keys, stdin_calc, 0 };
static const wire_class stdin_class = { "$bog_wire_stdin", 0, 1, 0 };

static void stdin_ensure( void ) {
	if( !input.obj ) input.obj = wire_obj_new( &stdin_class, true );
}

wire_val wire_stdin( int64_t index ) {
	stdin_ensure();
	wire_val key = { .i = index };
	return wire_read( input.obj, &stdin_member, &key, NULL );
}

static void stdin_pull( void ) {
	wire_buf buf = { 0 };
	int got = 0;
	int ch;

	while( ( ch = fgetc( stdin ) ) != EOF ) {
		got = 1;
		if( ch == '\n' ) break;
		char byte = ( char ) ch;
		wire_buf_lit( &buf, &byte, 1 );
	}

	if( !got ) {
		input.eof = true;
		free( buf.data );
	} else {
		if( buf.len && buf.data[ buf.len - 1 ] == '\r' ) buf.len -= 1;
		if( input.len == input.cap ) {
			input.cap = input.cap * 2 + 16;
			input.lines = grow( input.lines, sizeof( wire_val ) * input.cap );
		}
		input.lines[ input.len++ ] = text_raw( buf.data ? buf.data : "", buf.len );
		free( buf.data );
	}

	wire_ids waiters = ids_take( &input.waiters );
	for( int i = 0; i < waiters.len; ++i ) mark( waiters.items[ i ], STALE );
	ids_free( &waiters );
}

void wire_sync( void ) {
	reap();
	for( int i = 0; i < rt.garbage_len; ++i ) box_free( rt.garbage[ i ] );
	rt.garbage_len = 0;
}

int64_t wire_alive( void ) {
	int64_t count = 0;
	for( uint32_t i = 0; i < rt.len; ++i ) if( rt.nodes[ i ].alive ) count += 1;
	return count;
}

bool wire_effect( void ) {
	rt.effect_index += 1;
	if( rt.effect_index <= rt.effect_done ) return false;
	rt.effect_done = rt.effect_index;
	return true;
}

void wire_assert( bool ok, const char* where ) {
	if( ok ) return;
	wire_failures += 1;
	fflush( stdout );
	fprintf( stderr, "assert failed at %s\n", where );
}

void wire_print( wire_val text ) {
	wire_text* own = ( wire_text* ) text.box;
	fwrite( own->bytes, 1, own->len, stdout );
	fputc( '\n', stdout );
}

typedef struct {
	wire_obj* obj;
	wire_id node;
	wire_action action;
	int done;
} wire_task;

typedef struct {
	wire_task* items;
	int head;
	int len;
	int cap;
} wire_tasks;

static wire_tasks tasks;
static wire_tasks suspended;

static void tasks_push( wire_tasks* queue, wire_task task ) {
	if( queue->head + queue->len == queue->cap ) {
		if( queue->head ) {
			memmove( queue->items, queue->items + queue->head, sizeof( wire_task ) * queue->len );
			queue->head = 0;
		} else {
			queue->cap = queue->cap * 2 + 8;
			queue->items = grow( queue->items, sizeof( wire_task ) * queue->cap );
		}
	}
	queue->items[ queue->head + queue->len++ ] = task;
}

static wire_task tasks_pop( wire_tasks* queue ) {
	wire_task task = queue->items[ queue->head++ ];
	queue->len -= 1;
	if( !queue->len ) queue->head = 0;
	return task;
}

void wire_after( wire_obj* obj, wire_action action ) {
	tasks_push( &tasks, ( wire_task ){ obj, obj->node, action, 0 } );
}

static bool attempt( wire_task* task ) {
	if( !get( task->node ) ) fail( "task on destroyed object" );

	rt.effect_index = 0;
	rt.effect_done = task->done;

	int mark_scope = scope.len;
	wire_id current = rt.current;
	rt.current = none;

	wire_frame frame;
	frame.prev = rt.frame;
	rt.frame = &frame;

	if( setjmp( frame.jump ) ) {
		rt.frame = frame.prev;
		rt.current = current;
		scope_end( mark_scope );
		task->done = rt.effect_done;
		return false;
	}

	task->action( task->obj, NULL );

	rt.frame = frame.prev;
	rt.current = current;
	scope_end( mark_scope );
	return true;
}

static void run( wire_obj* root, wire_action action ) {
	tasks_push( &tasks, ( wire_task ){ root, root->node, action, 0 } );

	while( true ) {

		if( tasks.len ) {
			wire_task task = tasks_pop( &tasks );
			if( !attempt( &task ) ) tasks_push( &suspended, task );
			wire_sync();
			continue;
		}

		if( suspended.len && input.waiters.len ) {
			stdin_pull();
			while( suspended.len ) tasks_push( &tasks, tasks_pop( &suspended ) );
			continue;
		}

		if( suspended.len ) fail( "tasks wait forever" );

		break;
	}

	wire_obj_destroy( root );
	wire_sync();
}

int wire_main( const wire_class* cls, wire_action action ) {
	stdin_ensure();
	run( wire_obj_new( cls, true ), action );

	int64_t leaked_values = wire_live - input.len - 1;
	int64_t leaked_nodes = wire_alive() - 1;

	if( leaked_values || leaked_nodes ) {
		fflush( stdout );
		fprintf( stderr, "leaked %lld values, %lld nodes\n", ( long long ) leaked_values, ( long long ) leaked_nodes );
		return 1;
	}

	return wire_failures ? 1 : 0;
}

int wire_test( const char* name, const wire_class* cls, wire_action action ) {
	stdin_ensure();
	input.eof = true;

	int failures = wire_failures;
	int64_t live = wire_live;
	int64_t nodes = wire_alive();

	run( wire_obj_new( cls, true ), action );

	int64_t leaked_values = wire_live - live;
	int64_t leaked_nodes = wire_alive() - nodes;

	if( failures == wire_failures && !leaked_values && !leaked_nodes ) {
		printf( "ok %s\n", name );
		return 0;
	}

	printf( "fail %s", name );
	if( leaked_values || leaked_nodes ) printf( " leaked %lld values, %lld nodes", ( long long ) leaked_values, ( long long ) leaked_nodes );
	printf( "\n" );
	fflush( stdout );
	return 1;
}
