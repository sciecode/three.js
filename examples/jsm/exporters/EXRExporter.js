/**
 * @author sciecode / https://github.com/sciecode
 */

import {
	FloatType,
	GammaEncoding,
	LinearEncoding,
	RGBEEncoding,
	UnsignedByteType,
	sRGBEncoding
} from "../../../build/three.module.js";

const TE = new TextEncoder();

var EXRExporter = function () {};

EXRExporter.prototype = {

	constructor: EXRExporter,

	parse: function ( renderer, renderTarget ) {

		if ( renderTarget.texture.type != FloatType && renderTarget.texture.type != UnsignedByteType ) {

			console.error( "EXRExporter: Unsupported type." );

			return false;

		}

		const TYPE = renderTarget.texture.type;
		const FORMAT = renderTarget.texture.format;
		const ENCODING = renderTarget.texture.encoding;

		const info = {
			width: renderTarget.width,
			height: renderTarget.height,
			type: TYPE,
			format: FORMAT,
			encoding: ENCODING,
			gamma: renderer.gammaFactor,
			IN_CHANNELS: 4,
			OUT_CHANNELS: ( ENCODING == RGBEEncoding ) ? 3 : 4
		};

		let dataBuffer = getPixelData( renderer, renderTarget, info );

		let rawContentBuffer = new Float32Array( info.width * info.height * info.OUT_CHANNELS );
		reorganizeDataBuffer( dataBuffer, rawContentBuffer, info );

		// compress_data

		let headerSize = getHeaderSize( info );
		let contentSize = rawContentBuffer.length * 4 + renderTarget.height * 8;

		let outBuffer = new Uint8Array( headerSize + contentSize );

		fillHeader( outBuffer, info );

		fillData( outBuffer, rawContentBuffer, headerSize, info );

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

function getFloat32( arr, i ) {

	return arr[ i ];

}

function getUint8( arr, i ) {

	return arr[ i ] / 255;

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

function reorganizeVEC3( inBuffer, outBuffer, info ) {

	let decode;
	const w = info.width,
		h = info.height,
		dec = {
			r: 0,
			g: 0,
			b: 0,
		};

	switch ( info.encoding ) {

		case RGBEEncoding:
			decode = decodeRGBE;
			break;

	}

	for ( let y = 0; y < h; ++ y ) {

		for ( let x = 0; x < w; ++ x ) {

			let i = y * w * 4 + x * 4;

			const r = getUint8( inBuffer, i );
			const g = getUint8( inBuffer, i + 1 );
			const b = getUint8( inBuffer, i + 2 );
			const a = getUint8( inBuffer, i + 3 );

			decode( dec, r, g, b, a );

			const line = ( h - y - 1 ) * w * 3;

			outBuffer[ line + x ] = dec.b;
			outBuffer[ line + w + x ] = dec.b;
			outBuffer[ line + 2 * w + x ] = dec.b;

		}

	}

}

function reorganizeVEC4( inBuffer, outBuffer, info ) {

	let decode,
		getValue = ( info.type == FloatType ) ? getFloat32 : getUint8;

	const w = info.width,
		h = info.height,
		dec = {
			r: 0,
			g: 0,
			b: 0,
			a: 0,
		};

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

			const line = ( h - y - 1 ) * w * 4;

			decode( dec, r, g, b, a, info.gamma );

			outBuffer[ line + x ] = dec.a;
			outBuffer[ line + w + x ] = dec.b;
			outBuffer[ line + 2 * w + x ] = dec.g;
			outBuffer[ line + 3 * w + x ] = dec.r;

		}

	}

}

function getHeaderSize( info ) {

	let magic = 4;
	let mask = 4;

	let compression = 12 + 12 + 4 + 1; // str name | str type | i32 size | i8 content [ 0 ]
	let screenWindowCenter = 19 + 4 + 4 + 8; // str name | v2f type | i32 size | 2 * i32 content [0, 0]
	let screenWindowWidth = 18 + 6 + 4 + 4; // str name | float type | i32 size | i32 content [ 1 ]
	let pixelAspectRatio = 17 + 6 + 4 + 4; // str name | float type | i32 size | i32 content [ 1 ]
	let lineOrder = 10 + 10 + 4 + 1; // str name | lineOrder type | i32 size | i8 content [ 0 ]
	let dataWindow = 11 + 6 + 4 + 16; // str name | box2i type | i32 size | 4 * i32 content [0, 0, w, h]
	let displayWindow = 14 + 6 + 4 + 16; // str name | box2i type | i32 size | 4 * i32 content [0, 0, w, h]
	let channels = 9 + 7 + 4 + ( 18 * info.OUT_CHANNELS ) + 1; // str name | chlist type | i32 size | chlist content

	let end = 1;

	const HeaderSize = magic + mask + compression + screenWindowCenter + screenWindowWidth + pixelAspectRatio + lineOrder + dataWindow + displayWindow + channels + end;
	const TableSize = info.height * 8;

	return HeaderSize + TableSize;

}

function fillHeader( outBuffer, info ) {

	const offset = { value: 0 };
	const dv = new DataView( outBuffer.buffer );

	setUint32( dv, 20000630, offset ); // magic
	setUint32( dv, 2, offset ); // magic

	// = HEADER =

	setString( dv, 'compression', offset );
	setString( dv, 'compression', offset );
	setUint32( dv, 1, offset );
	setUint8( dv, 0, offset );

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
	setUint32( dv, 55, offset );

	if ( info.OUT_CHANNELS == 4 ) {

		setString( dv, 'A', offset );
		setUint32( dv, 2, offset );
		offset.value += 4;
		setUint32( dv, 1, offset );
		setUint32( dv, 1, offset );

	}

	setString( dv, 'B', offset );
	setUint32( dv, 2, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setString( dv, 'G', offset );
	setUint32( dv, 2, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setString( dv, 'R', offset );
	setUint32( dv, 2, offset );
	offset.value += 4;
	setUint32( dv, 1, offset );
	setUint32( dv, 1, offset );

	setUint8( dv, 0, offset );

	// null-byte
	setUint8( dv, 0, offset );

	// = OFFSET TABLE =

	let SUM = offset.value + info.height * 8;

	for ( let i = 0; i < info.height; ++ i ) {

		setUint64( dv, SUM, offset );

		SUM += info.width * info.OUT_CHANNELS * 4 + 8;

	}

}

function fillData( outBuffer, rawBuffer, hs, info ) {

	const dv = new DataView( outBuffer.buffer );

	let offset = { value: hs };
	let dataOffset = { value: 0 };
	let size = info.width * info.OUT_CHANNELS;

	for ( let i = 0; i < info.height; ++ i ) {

		setUint32( dv, i, offset );
		setUint32( dv, size * 4, offset );

		for ( let x = 0; x < size; ++ x ) {

			setFloat32( dv, rawBuffer[ dataOffset.value ], offset );
			dataOffset.value ++;

		}

	}

}

function setUint8( dv, value, offset ) {

	dv.setUint8( offset.value, value );

	offset.value += 1;

}

function setUint32( dv, value, offset ) {

	dv.setUint32( offset.value, value, true );

	offset.value += 4;

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

	const tmp = TE.encode( string + '\0' );

	for ( let i = 0; i < tmp.length; ++ i ) {

		setUint8( dv, tmp[ i ], offset );

	}

}

export { EXRExporter };
