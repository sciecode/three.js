/**
 * @author sciecode / https://github.com/sciecode
 */

import {
	FloatType,
	GammaEncoding,
	HalfFloatType,
	LinearEncoding,
	RGBEEncoding,
	UnsignedByteType,
	sRGBEncoding
} from "../../../build/three.module.js";
import { Zlib } from "../libs/deflate.module.min.js";

const textEncoder = new TextEncoder();
const tmpDataView = new DataView( new ArrayBuffer( 8 ) );

var EXRExporter = function () {

	this.type = HalfFloatType;
	this.compression = 3;

};

EXRExporter.prototype = {

	constructor: EXRExporter,

	setDataType: function ( type ) {

		this.type = type;
		return this;

	},

	parse: function ( renderer, renderTarget ) {

		if ( renderTarget.texture.type != FloatType && renderTarget.texture.type != UnsignedByteType ) {

			console.error( "EXRExporter: Unsupported type." );

			return false;

		}

		const TYPE = renderTarget.texture.type;
		const FORMAT = renderTarget.texture.format;
		const ENCODING = renderTarget.texture.encoding;

		const compressionSizes = {
			0: 1,
			3: 16
		};

		const info = {
			width: renderTarget.width,
			height: renderTarget.height,
			type: TYPE,
			format: FORMAT,
			encoding: ENCODING,
			gamma: renderer.gammaFactor,
			compression: this.compression,
			blockLines: compressionSizes[ this.compression ],
			outType: ( this.type == HalfFloatType ) ? 1 : 2,
			IN_CHANNELS: 4,
			OUT_CHANNELS: ( ENCODING == RGBEEncoding ) ? 3 : 4,
		};

		let dataBuffer = getPixelData( renderer, renderTarget, info );

		let rawContentBuffer = new Uint8Array( info.width * info.height * info.OUT_CHANNELS * 2.0 * info.outType );
		reorganizeDataBuffer( dataBuffer, rawContentBuffer, info );

		const chunks = { data: new Array(), totalSize: 0 };
		compressData( rawContentBuffer, chunks, info );

		let headerSize = getHeaderSize( info, chunks );

		let outBuffer = new Uint8Array( headerSize + chunks.totalSize + Math.ceil( info.height / info.blockLines ) * 8 );

		fillHeader( outBuffer, chunks, info );

		fillData( outBuffer, chunks, headerSize, info );

		return outBuffer;

	}

};

function getPixelData( renderer, rtt, info ) {

	let dataBuffer;

	if ( info.type == FloatType ) {

		dataBuffer = new Float32Array( info.width * info.height * info.IN_CHANNELS );

	} else {

		dataBuffer = new Uint8Array( info.width * info.height * info.IN_CHANNELS );

	}

	renderer.readRenderTargetPixels( rtt, 0, 0, info.width, info.height, dataBuffer );

	return dataBuffer;

}

function reorganizeDataBuffer( inBuffer, outBuffer, info ) {

	if ( info.OUT_CHANNELS == 3 ) {

		reorganizeVEC3( inBuffer, outBuffer, info );

	} else {

		reorganizeVEC4( inBuffer, outBuffer, info );

	}

	return outBuffer;

}

function reorganizeVEC3( inBuffer, outBuffer, info ) {

	const byteSize = 2 * info.outType,
		w = info.width,
		h = info.height,
		dv = new DataView( outBuffer.buffer ),
		dec = { r: 0, g: 0, b: 0 },
		offset = { value: 0 },
		getValue = ( info.type == FloatType ) ? getFloat32 : getUint8,
		setValue = ( info.outType == 1 ) ? setFloat16 : setFloat32;

	let decode;

	switch ( info.encoding ) {

		case RGBEEncoding:
			decode = decodeRGBE;
			break;

	}

	for ( let y = 0; y < h; ++ y ) {

		for ( let x = 0; x < w; ++ x ) {

			let i = y * w * 4 + x * 4;

			const r = getValue( inBuffer, i );
			const g = getValue( inBuffer, i + 1 );
			const b = getValue( inBuffer, i + 2 );
			const a = getValue( inBuffer, i + 3 );

			const line = ( h - y - 1 ) * w * 3 * byteSize;

			decode( dec, r, g, b, a );

			offset.value = line + x * byteSize;
			setValue( dv, dec.b, offset );

			offset.value = line + w * byteSize + x * byteSize;
			setValue( dv, dec.g, offset );

			offset.value = line + 2 * w * byteSize + x * byteSize;
			setValue( dv, dec.r, offset );

		}

	}

}

function reorganizeVEC4( inBuffer, outBuffer, info ) {

	const byteSize = 2 * info.outType,
		w = info.width,
		h = info.height,
		dv = new DataView( outBuffer.buffer ),
		dec = { r: 0, g: 0, b: 0, a: 0 },
		offset = { value: 0 },
		getValue = ( info.type == FloatType ) ? getFloat32 : getUint8,
		setValue = ( info.outType == 1 ) ? setFloat16 : setFloat32;

	let decode;

	switch ( info.encoding ) {

		case LinearEncoding:
			decode = decodeLinear;
			break;

		case sRGBEncoding:
			decode = decodeSRGB;
			break;

		case GammaEncoding:
			decode = decodeGamma;
			break;

	}

	for ( let y = 0; y < h; ++ y ) {

		for ( let x = 0; x < w; ++ x ) {

			let i = y * w * 4 + x * 4;

			const r = getValue( inBuffer, i );
			const g = getValue( inBuffer, i + 1 );
			const b = getValue( inBuffer, i + 2 );
			const a = getValue( inBuffer, i + 3 );

			const line = ( h - y - 1 ) * w * 4 * byteSize;

			decode( dec, r, g, b, a, info.gamma );

			offset.value = line + x * byteSize;
			setValue( dv, dec.a, offset );

			offset.value = line + w * byteSize + x * byteSize;
			setValue( dv, dec.b, offset );

			offset.value = line + 2 * w * byteSize + x * byteSize;
			setValue( dv, dec.g, offset );

			offset.value = line + 3 * w * byteSize + x * byteSize;
			setValue( dv, dec.r, offset );

		}

	}

}

function compressData( inBuffer, chunks, info ) {

	let sum = 0, compress;
	const size = info.width * info.OUT_CHANNELS * info.blockLines * 2 * info.outType;

	switch ( info.compression ) {

		case 0:
			compress = compressNONE;
			break;

		case 3:
			compress = compressZIP;
			break;

	}

	for ( let i = 0; i < ( info.height / info.blockLines ); ++ i ) {

		const arr = inBuffer.subarray( size * i, size * ( i + 1 ) );

		const block = compress( arr );

		sum += block.length;

		chunks.data.push( { dataChunk: block, size: block.length } );

	}

	chunks.totalSize = sum;

}

function compressNONE( data ) {

	return data;

}

function compressZIP( data ) {

	//
	// Reorder the pixel data.
	//

	const tmpBuffer = new Uint8Array( data.length );

	let t1 = 0,
		t2 = Math.floor( ( data.length + 1 ) / 2 ),
		s = 0;

	const stop = data.length - 1;

	while ( true ) {

		if ( s > stop ) break;
		tmpBuffer[ t1 ++ ] = data[ s ++ ];

		if ( s > stop ) break;
		tmpBuffer[ t2 ++ ] = data[ s ++ ];

	}

	//
	// Predictor.
	//

	let p = tmpBuffer[ 0 ];

	for ( let t = 1; t < tmpBuffer.length; t ++ ) {

		const d = tmpBuffer[ t ] - p + ( 128 + 256 );
		p = tmpBuffer[ t ];
		tmpBuffer[ t ] = d;

	}

	if ( typeof Zlib === 'undefined' ) {

		console.error( 'THREE.EXRLoader: External library Deflate.min.js required, obtain or import from https://github.com/imaya/zlib.js' );

	}

	const deflate = new Zlib.Deflate( tmpBuffer ); // eslint-disable-line no-undef

	return deflate.compress();

}

function getHeaderSize( info ) {

	const magic = 4;
	const mask = 4;

	const compression = 12 + 12 + 4 + 1; // str name | str type | i32 size | i8 content [ 0 ]
	const screenWindowCenter = 19 + 4 + 4 + 8; // str name | v2f type | i32 size | 2 * i32 content [0, 0]
	const screenWindowWidth = 18 + 6 + 4 + 4; // str name | float type | i32 size | i32 content [ 1 ]
	const pixelAspectRatio = 17 + 6 + 4 + 4; // str name | float type | i32 size | i32 content [ 1 ]
	const lineOrder = 10 + 10 + 4 + 1; // str name | lineOrder type | i32 size | i8 content [ 0 ]
	const dataWindow = 11 + 6 + 4 + 16; // str name | box2i type | i32 size | 4 * i32 content [0, 0, w, h]
	const displayWindow = 14 + 6 + 4 + 16; // str name | box2i type | i32 size | 4 * i32 content [0, 0, w, h]
	const channels = 9 + 7 + 4 + ( 18 * info.OUT_CHANNELS ) + 1; // str name | chlist type | i32 size | chlist content

	const end = 1;

	const HeaderSize = magic + mask + compression + screenWindowCenter + screenWindowWidth + pixelAspectRatio + lineOrder + dataWindow + displayWindow + channels + end;
	const TableSize = Math.ceil( info.height / info.blockLines ) * 8;

	return HeaderSize + TableSize;

}

function fillHeader( outBuffer, chunks, info ) {

	const offset = { value: 0 };
	const dv = new DataView( outBuffer.buffer );

	setUint32( dv, 20000630, offset ); // magic
	setUint32( dv, 2, offset ); // magic

	// = HEADER =

	setString( dv, 'compression', offset );
	setString( dv, 'compression', offset );
	setUint32( dv, 1, offset );
	setUint8( dv, info.compression, offset );

	setString( dv, 'screenWindowCenter', offset );
	setString( dv, 'v2f', offset );
	setUint32( dv, 8, offset );
	setUint32( dv, 0, offset );
	setUint32( dv, 0, offset );

	setString( dv, 'screenWindowWidth', offset );
	setString( dv, 'float', offset );
	setUint32( dv, 4, offset );
	setFloat32( dv, 1.0, offset );

	setString( dv, 'pixelAspectRatio', offset );
	setString( dv, 'float', offset );
	setUint32( dv, 4, offset );
	setFloat32( dv, 1.0, offset );

	setString( dv, 'lineOrder', offset );
	setString( dv, 'lineOrder', offset );
	setUint32( dv, 1, offset );
	setUint8( dv, 0, offset );

	setString( dv, 'dataWindow', offset );
	setString( dv, 'box2i', offset );
	setUint32( dv, 16, offset );
	setUint32( dv, 0, offset );
	setUint32( dv, 0, offset );
	setUint32( dv, info.width - 1, offset );
	setUint32( dv, info.height - 1, offset );

	setString( dv, 'displayWindow', offset );
	setString( dv, 'box2i', offset );
	setUint32( dv, 16, offset );
	setUint32( dv, 0, offset );
	setUint32( dv, 0, offset );
	setUint32( dv, info.width - 1, offset );
	setUint32( dv, info.height - 1, offset );

	setString( dv, 'channels', offset );
	setString( dv, 'chlist', offset );
	setUint32( dv, info.OUT_CHANNELS * 18 + 1, offset );

	if ( info.OUT_CHANNELS == 4 ) {

		setString( dv, 'A', offset );
		setUint32( dv, info.outType, offset );
		offset.value += 4;
		setUint32( dv, 1, offset );
		setUint32( dv, 1, offset );

	}

	setString( dv, 'B', offset );
	setUint32( dv, info.outType, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setString( dv, 'G', offset );
	setUint32( dv, info.outType, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setString( dv, 'R', offset );
	setUint32( dv, info.outType, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setUint8( dv, 0, offset );

	// null-byte
	setUint8( dv, 0, offset );

	// = OFFSET TABLE =

	let SUM = offset.value + Math.ceil( info.height / info.blockLines ) * 8;

	for ( let i = 0; i < chunks.data.length; ++ i ) {

		setUint64( dv, SUM, offset );

		SUM += chunks.data[ i ].size + 8;

	}

}

function fillData( outBuffer, chunks, hs, info ) {

	const offset = { value: hs },
		dv = new DataView( outBuffer.buffer );

	for ( let i = 0; i < chunks.data.length; ++ i ) {

		const data = chunks.data[ i ].dataChunk;
		const size = chunks.data[ i ].size;

		setUint32( dv, i * info.blockLines, offset );
		setUint32( dv, size, offset );

		outBuffer.set( data, offset.value );
		offset.value += size;

	}

}

// http://gamedev.stackexchange.com/questions/17326/conversion-of-a-number-from-single-precision-floating-point-representation-to-a/17410#17410
function encodeFloat16( val ) {

	/* This method is faster than the OpenEXR implementation (very often
	 * used, eg. in Ogre), with the additional benefit of rounding, inspired
	 * by James Tursa's half-precision code.
	*/

	tmpDataView.setFloat32( 0, val );
	let x = tmpDataView.getInt32( 0 ),
		m = ( x >> 12 ) & 0x07ff, /* Keep one extra bit for rounding */
		e = ( x >> 23 ) & 0xff; /* Using int is faster here */

	let bits = ( x >> 16 ) & 0x8000; /* Get the sign */

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

function setUint8( dv, value, offset ) {

	dv.setUint8( offset.value, value );

	offset.value += 1;

}

function setUint32( dv, value, offset ) {

	dv.setUint32( offset.value, value, true );

	offset.value += 4;

}

function setFloat16( dv, value, offset ) {

	dv.setUint16( offset.value, encodeFloat16( value ), true );

	offset.value += 2;

}

function setFloat32( dv, value, offset ) {

	dv.setFloat32( offset.value, value, true );

	offset.value += 4;

}

function setUint64( dv, value, offset ) {

	dv.setBigUint64( offset.value, BigInt( value ), true );

	offset.value += 8;

}

function setString( dv, string, offset ) {

	const tmp = textEncoder.encode( string + '\0' );

	for ( let i = 0; i < tmp.length; ++ i ) {

		setUint8( dv, tmp[ i ], offset );

	}

}

function getUint8( arr, i ) {

	return arr[ i ] / 255;

}

function getFloat32( arr, i ) {

	return arr[ i ];

}

function decodeLinear( dec, r, g, b, a ) {

	dec.r = r;
	dec.g = g;
	dec.b = b;
	dec.a = a;

}

function decodeSRGB( dec, r, g, b, a ) {

	dec.r = r > 0.04045 ? Math.pow( r * 0.9478672986 + 0.0521327014, 2.4 ) : r * 0.0773993808;
	dec.g = g > 0.04045 ? Math.pow( g * 0.9478672986 + 0.0521327014, 2.4 ) : g * 0.0773993808;
	dec.b = b > 0.04045 ? Math.pow( b * 0.9478672986 + 0.0521327014, 2.4 ) : b * 0.0773993808;
	dec.a = a;

}

function decodeGamma( dec, r, g, b, a, gamma ) {

	dec.r = Math.pow( r, gamma );
	dec.g = Math.pow( g, gamma );
	dec.b = Math.pow( b, gamma );
	dec.a = a;

}

function decodeRGBE( dec, r, g, b, a ) {

	const exp = Math.pow( 2, a * 255 - 128.0 );
	dec.r = r * exp;
	dec.g = g * exp;
	dec.b = b * exp;

}

export { EXRExporter };
