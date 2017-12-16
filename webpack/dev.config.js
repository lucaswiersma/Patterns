const merge = require('webpack-merge');
var baseConfig = require('./base.config.js');
var JasmineWebpackPlugin = require('jasmine-webpack-plugin');


module.exports = merge(baseConfig, {
    devServer: {
    	inline: true,
        contentBase: './',
        port: '3001'
    },
	plugins: [
        new JasmineWebpackPlugin(),
    ],
});