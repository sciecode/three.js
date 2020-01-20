/**
 * @author sciecode / https://github.com/sciecode
 */

var INT8_SIZE = 1;
var INT16_SIZE = 2;
var INT32_SIZE = 4;
var INT64_SIZE = 8;

var tmpView = new DataView( new ArrayBuffer( 4 ) );

THREE.DataParser = function ( buffer, offset, littleEndian ) {

	this.dataView = new DataView( buffer );
	this.offset = ( offset === undefined ) ? 0 : offset;
	this.littleEndian = ( littleEndian === undefined ) ? false : littleEndian;

	return this;

};

THREE.DataParser.prototype = {

	constructor: THREE.DataParser,

	skip: function ( bytes ) {

		this.offset += bytes;

	},

	getInt8: function () {

		var int8 = this.dataView.getInt8( this.offset );
		this.offset += INT8_SIZE;
		return int8;

	},

	getInt8Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getInt8();
		return arr;

	},

	getInt16: function () {

		var int16 = this.dataView.getInt16( this.offset, this.littleEndian );
		this.offset += INT16_SIZE;
		return int16;

	},

	getInt16Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getInt16();
		return arr;

	},

	getInt32: function () {

		var int32 = this.dataView.getInt32( this.offset, this.littleEndian );
		this.offset += INT32_SIZE;
		return int32;

	},

	getInt32Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getInt32();
		return arr;

	},

	getInt64: function () {

		var int64 = this.dataView.getBigInt64( this.offset, this.littleEndian );
		this.offset += INT64_SIZE;
		return int64;

	},

	getInt64Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getInt64();
		return arr;

	},

	getUint8: function () {

		var uint8 = this.dataView.getUint8( this.offset );
		this.offset += INT8_SIZE;
		return uint8;

	},

	getUint8Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getUint8();
		return arr;

	},

	getUint16: function () {

		var uint16 = this.dataView.getUint16( this.offset, this.littleEndian );
		this.offset += INT16_SIZE;
		return uint16;

	},

	getUint16Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getUint16();
		return arr;

	},

	getUint32: function () {

		var int32 = this.dataView.getInt32( this.offset, this.littleEndian );
		this.offset += INT32_SIZE;
		return int32;

	},

	getUint32Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getUint32();
		return arr;

	},

	getUint64: function () {

		var uint64 = this.dataView.getBigUint64( this.offset, this.littleEndian );
		this.offset += INT64_SIZE;
		return uint64;

	},

	getUint64Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getUint64();
		return arr;

	},

	getFloat16: function () {

		var uint16 = this.dataView.getUint16( this.offset, this.littleEndian );
		this.offset += INT16_SIZE;
		return THREE.DataParser.decodeFloat16( uint16 );

	},

	getFloat16Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getFloat16();
		return arr;

	},

	getFloat32: function () {

		var float32 = this.dataView.getFloat32( this.offset, this.littleEndian );
		this.offset += INT32_SIZE;
		return float32;

	},

	getFloat32Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getFloat32();
		return arr;

	},

	getFloat64: function () {

		var float64 = this.dataView.getFloat64( this.offset, this.littleEndian );
		this.offset += INT64_SIZE;
		return float64;

	},

	getFloat64Array: function ( size ) {

		var arr = new Array( size );
		for ( var i = 0; i < size; ++ i ) arr[ i ] = this.getFloat64();
		return arr;

	},

	getString: function ( bytes ) {

		var string = THREE.LoaderUtils.decodeText( new Uint8Array( this.dataView.buffer, this.offset, bytes ) );
		this.offset += bytes;
		return string;

	},

	getNullTerminatedString: function () {

		var stringOffset = 0;
		while ( this.dataView.getUint8( this.offset + stringOffset ) != 0 ) stringOffset += 1;

		var string = THREE.LoaderUtils.decodeText( new Uint8Array( this.dataView.buffer, this.offset, stringOffset ) );
		this.offset += stringOffset + 1;
		return string;

	},

};

Object.assign( THREE.DataParser, {

	// https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
	decodeFloat16: function ( data ) {

		var exponent = ( data & 0x7C00 ) >> 10;
		var fraction = data & 0x03FF;

		return ( data >> 15 ? - 1 : 1 ) * (
			exponent ?
				(
					exponent === 0x1F ?
						fraction ? NaN : Infinity :
						Math.pow( 2, exponent - 15 ) * ( 1 + fraction / 0x400 )
				) :
				6.103515625e-5 * ( fraction / 0x400 )
		);

	},

	// http://gamedev.stackexchange.com/questions/17326/conversion-of-a-number-from-single-precision-floating-point-representation-to-a/17410#17410
	encodeFloat16: function ( data ) {

		tmpView.setFloat32( 0, data );
		var x = tmpView.getInt32( 0 );

		var bits = ( x >> 16 ) & 0x8000; /* Get the sign */
		var m = ( x >> 12 ) & 0x07ff; /* Keep one extra bit for rounding */
		var e = ( x >> 23 ) & 0xff; /* Using int is faster here */

		/* If zero, or denormal, or exponent underflows too much for a denormal
			* half, return signed zero. */
		if ( e < 103 ) return bits;

		/* If NaN, return NaN. If Inf or exponent overflow, return Inf. */
		if ( e > 142 ) {

			bits |= 0x7c00;
			/* If exponent was 0xff and one mantissa bit was set, it means NaN,
						* not Inf, so make sure we set one mantissa bit too. */
			bits |= ( ( e == 255 ) ? 0 : 1 ) && ( x & 0x007fffff );
			return bits;

		}

		/* If exponent underflows but not too much, return a denormal */
		if ( e < 113 ) {

			m |= 0x0800;
			/* Extra rounding may overflow and set mantissa to 0 and exponent
				* to 1, which is OK. */
			bits |= ( m >> ( 114 - e ) ) + ( ( m >> ( 113 - e ) ) & 1 );
			return bits;

		}

		bits |= ( ( e - 112 ) << 10 ) | ( m >> 1 );
		/* Extra rounding. An overflow will set mantissa to 0 and increment
			* the exponent, which is OK. */
		bits += m & 1;
		return bits;

	}

} );
