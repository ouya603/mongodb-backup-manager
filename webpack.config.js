const path = require('path');
const webpack = require('webpack');
const fs = require('fs');

const nodeModules = {};
fs.readdirSync('node_modules')
  .filter(function(x) {
    return ['.bin'].indexOf(x) === -1;
  })
  .forEach(function(mod) {
    nodeModules[mod] = 'commonjs ' + mod;
  });

module.exports= {
    entry: {
        app: path.resolve(__dirname, './server/app.js')
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
    },
    externals: nodeModules,
    target: "node",
    node: {
        console: false,
        global: false,
        process: false,
        Buffer: false,
        __filename: false,
        __dirname: false,
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['es2015']
                    }
                }
            }
        ]
    },
    plugins: [
		new webpack.optimize.UglifyJsPlugin({
	        compress: {
	          warnings: false
	        }
    	}),
    ],
    resolve: {
        alias: {
            modules: path.resolve(__dirname, "./server/modules/")
        }
    }
};