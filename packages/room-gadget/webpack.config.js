
const path = require('path');
var HtmlWebpackPlugin = require( 'html-webpack-plugin' );
const CopyPlugin = require('copy-webpack-plugin');
const { WatchIgnorePlugin } = require( 'webpack' );
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

module.exports = 
[
	{
		mode: "development",
		devtool: "inline-source-map",

		entry: './src/room_gadget_main.tsx',

		output:
		{
			filename: '[name].js',
			path: path.resolve( __dirname, './dist' ),
		},

		plugins:
		[
			new HtmlWebpackPlugin(
				{
					hash: true,
					filename: "./index.html",
					template: "./src/index.html"
				}
			),
			new CopyPlugin([
					{ from: './src/styles.css', to: 'styles.css' },
					{ from: './src/manifest.webmanifest', to: 'manifest.webmanifest' },
					{ from: './src/models/*', to: 'models/[name].[ext]' },
				] 
				),
			new WatchIgnorePlugin( 
				[
					/\.ts\.d/,
					/dist\//
				] ),
		],
		
		module: 
		{
			rules:
			[
				{ 
					test: /.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/
				},
				{
					test: /.css$/,
					use: 
					[
						'style-loader',
						'css-loader'
					]
				},
				{
					test: /.(png|svg|jpg|gif)$/,
					use: 
					[
						'file-loader'
					]
				}
					
			]
		},

		resolve:
		{
			// alias: 
			// { 
			// 	"crypto": false, 
			// 	"buffer": false, 
			// },
			modules:[ path.resolve( __dirname, 'node_modules' ),
		path.resolve( __dirname, "../../node_modules") ],
			extensions: [ '.ts', '.tsx', '.js' ],
			plugins: [new TsconfigPathsPlugin()],
		},
		
		watchOptions:
		{
			ignored: "./dist"
		}
	},

];

