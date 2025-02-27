
import {
	TextDocument, IConnection,
	Diagnostic,
	DiagnosticSeverity,
	TextDocuments,
	ErrorMessageTracker,
	DidChangeConfigurationParams
} from "vscode-languageserver";

import { URI } from 'vscode-uri';

import * as path from 'path';

let stripJsonComments: any = require('strip-json-comments');
import fs = require('fs');

import * as htmlhint from '../htmlhint';
var htmlHintClient: any = null;
let htmlhintrcOptions: any = {};

interface Settings {
	htmlhint: {
		enable: boolean;
		options: any;
	}
	[key: string]: any;
}

let settings: Settings | null = null;

const tagsTypings = {
	a: {
		selfclosing: false,
		attrsRequired: ['href'],
		redundantAttrs: ['alt']
	},
	div: {
		selfclosing: false
	},
	main: {
		selfclosing: false,
		redundantAttrs: ['role']
	},
	nav: {
		selfclosing: false,
		redundantAttrs: ['role']
	},
	script: {
		attrsOptional: [['async', 'async'], ['defer', 'defer']],
		redundantAttrs: ['type']
	},
	img: {
		selfclosing: true,
		attrsRequired: [
			'src', 'alt'
		]
	}
};

const defaultLinterConfig = {
	"tagname-lowercase": true,
	"attr-lowercase": false,
	"attr-value-double-quotes": false,
	"doctype-first": false,
	"max-lenght": false,
	"tag-pair": true,
	"spec-char-escape": false,
	"id-unique": false,
	"src-not-empty": true,
	"attr-no-duplication": true,
	"title-require": false,
	"doctype-html5": true,
	"space-tab-mixed-disabled": "space",
	"inline-style-disabled": false,
	"tag-self-close": true,
	"tags-check": {
		"isslot": {
			"selfclosing": true,
			"attrsRequired": ["id", ["context", "global", "category", "folder"], "description"]
		},
		"iscache": {
			"selfclosing": true,
			"attrsRequired": ["hour|minute", ["type", "relative", "daily"]],
			"attrsOptional": [["varyby", "price_promotion"]]
		},
		"isdecorate": {
			"selfclosing": false,
			"attrsRequired": ["template"]
		},
		"isreplace": {
			"selfclosing": true
		},
		"isinclude": {
			"selfclosing": true,
			"attrsRequired": ["template|url"]
		},
		"iscontent": {
			"selfclosing": true,
			"attrsOptional": [["encoding", "on", "off", "html", "xml", "wml"], ["compact", "true", "false"]],
			"attrsRequired": ["type", "charset"]
		},
		"ismodule": {
			"selfclosing": true,
			"attrsRequired": ["template", "name"]
		},
		"isobject": {
			"selfclosing": false,
			"attrsRequired": ["object", ["view", "none", "searchhit", "recommendation", "setproduct", "detail"]]
		},
		"isset": {
			"selfclosing": true,
			"attrsRequired": ["name", "value", ["scope", "session", "request", "page", "pdict"]]
		},
		"iscomponent": {
			"selfclosing": true,
			"attrsRequired": ["pipeline"]
		},
		"iscontinue": {
			"selfclosing": true
		},
		"isbreak": {
			"selfclosing": true
		},
		"isnext": {
			"selfclosing": true
		},
		"isscript": {
			"selfclosing": false
		},
		"iselse": {
			"selfclosing": true
		},
		"isloop": {
			"selfclosing": false,
			"attrsRequired": ["items|iterator|begin", "alias|var|end"]
		},
		"isif": {
			"selfclosing": false,
			"attrsRequired": ["condition"]
		},
		"iselseif": {
			"selfclosing": true,
			"attrsRequired": ["condition"]
		},
		"isprint": {
			"selfclosing": true,
			"attrsRequired": ["value"],
			"attrsOptional": [["encoding", "on", "off", "htmlcontent", "htmlsinglequote", "htmldoublequote", "htmlunquote", "jshtml", "jsattribute", "jsblock", "jssource", "jsonvalue", "uricomponent", "uristrict", "xmlcontent", "xmlsinglequote", "xmldoublequote", "xmlcomment"], ["timezone", "SITE", "INSTANCE", "utc"]]
		},
		"isstatus": {
			"selfclosing": true,
			"attrsRequired": ["value"]
		},
		"isredirect": {
			"selfclosing": true,
			"attrsOptional": [["permanent", "true", "false"]],
			"attrsRequired": ["location"]
		},
		"isinputfield": {
			"selfclosing": true,
			"attrsRequired": ["type", "formfield"]
		}
	}
};

const customRules = [{
	id: 'tags-check',
	description: 'Checks html tags.',
	init: function (parser, reporter, options) {
		var self = this;

		if (typeof options !== 'boolean') {
			Object.assign(tagsTypings, options);
		}

		parser.addListener('tagstart', function (event) {
			var attrs = event.attrs;
			var col = event.col + event.tagName.length + 1;

			const tagName = event.tagName.toLowerCase();

			if (tagsTypings[tagName]) {
				const currentTagType = tagsTypings[tagName];

				if (currentTagType.selfclosing === true && !event.close) {
					reporter.warn(`The <${tagName}> tag must be selfclosing.`, event.line, event.col, self, event.raw);
				} else if (currentTagType.selfclosing === false && event.close) {
					reporter.warn(`The <${tagName}> tag must not be selfclosing.`, event.line, event.col, self, event.raw);
				}

				if (currentTagType.attrsRequired) {
					currentTagType.attrsRequired.forEach(id => {
						if (Array.isArray(id)) {
							const copyOfId = id.map(a => a);
							const realID = copyOfId.shift();
							const values = copyOfId;

							if (attrs.some(attr => attr.name === realID)) {
								attrs.forEach(attr => {
									if (attr.name === realID && !values.includes(attr.value)) {
										reporter.error(`The <${tagName}> tag must have attr '${realID}' with one value of '${values.join('\' or \'')}'.`, event.line, col, self, event.raw);
									}
								});
							} else {
								reporter.error(`The <${tagName}> tag must have attr '${realID}'.`, event.line, col, self, event.raw);
							}
						} else if (!attrs.some(attr => id.split('|').includes(attr.name))) {
							reporter.error(`The <${tagName}> tag must have attr '${id}'.`, event.line, col, self, event.raw);
						}
					});
				}
				if (currentTagType.attrsOptional) {
					currentTagType.attrsOptional.forEach(id => {
						if (Array.isArray(id)) {
							const copyOfId = id.map(a => a);
							const realID = copyOfId.shift();
							const values = copyOfId;

							if (attrs.some(attr => attr.name === realID)) {
								attrs.forEach(attr => {
									if (attr.name === realID && !values.includes(attr.value)) {
										reporter.error(`The <${tagName}> tag must have optional attr '${realID}' with one value of '${values.join('\' or \'')}'.`, event.line, col + attr.index + 1, self, event.raw);
									}
								});
							}
						}
					});
				}

				if (currentTagType.redundantAttrs) {
					currentTagType.redundantAttrs.forEach(attrName => {
						if (attrs.some(attr => attr.name === attrName)) {
							reporter.error(`The attr '${attrName}' is redundant for <${tagName}> and should be ommited.`, event.line, col, self, event.raw);
						}
					});
				}

			}
		});
	}
}, {
	id: 'attr-no-duplication',
	description: 'Elements cannot have duplicate attributes.',
	init: function (parser, reporter) {
		var self = this;

		parser.addListener('tagstart', function (event) {
			var attrs = event.attrs;
			var attr;
			var attrName;
			var col = event.col + event.tagName.length + 1;

			if (event.tagName.toLowerCase() === 'ismodule') {
				return;
			}

			var mapAttrName = {};

			for (var i = 0, l = attrs.length; i < l; i++) {
				attr = attrs[i];
				attrName = attr.name;
				if (mapAttrName[attrName] === true) {
					reporter.error('Duplicate of attribute name [ ' + attr.name + ' ] was found.',
						event.line, col + attr.index, self, attr.raw);
				}
				mapAttrName[attrName] = true;
			}
		});
	}
}, {
	id: 'max-lenght',
	description: 'Lines limitation.',
	init(parser, reporter, option) {
		var self = this;

		if (option) {
			const checkLenght = event => {
				if (event.col > option) {
					reporter.error(
						`Line must be at most ${option} characters`,
						event.line - 1,
						event.col,
						self,
						event.raw
					);
				}
			};

			parser.addListener('tagstart', checkLenght);
			parser.addListener('text', checkLenght);
			parser.addListener('cdata', checkLenght);
			parser.addListener('tagend', checkLenght);
			parser.addListener('comment', checkLenght);
		}
	}
}
];

function getErrorMessage(err: any, document: TextDocument): string {
	let result: string;
	if (typeof err.message === 'string' || err.message instanceof String) {
		result = <string>err.message;
	} else {
		result = `An unknown error occured while validating file: ${URI.parse(document.uri).fsPath}`;
	}
	return result;
}

/**
 * Given a path to a .htmlhintrc file, load it into a javascript object and return it.
 */
function loadConfigurationFile(configFile): any {
	var ruleset: any = null;
	if (fs.existsSync(configFile)) {
		var config = fs.readFileSync(configFile, 'utf8');
		try {
			ruleset = JSON.parse(stripJsonComments(config));
		}
		catch (e) { }
	}
	return ruleset;
}

export function validateTextDocument(connection: IConnection, document: TextDocument): void {
	try {
		doValidate(connection, document);
	} catch (err) {
		connection.window.showErrorMessage(getErrorMessage(err, document));
	}
}

/**
 * Get the html-hint configuration settings for the given html file.  This method will take care of whether to use
 * VS Code settings, or to use a .htmlhintrc file.
 */
function getConfiguration(filePath: string): any {
	var options: any;
	if (
		settings &&
		settings.htmlhint &&
		settings.htmlhint.options &&
		Object.keys(settings.htmlhint.options).length > 0
	) {
		options = settings.htmlhint.options;
	}
	else {
		options = findConfigForHtmlFile(filePath);
	}

	options = options || {};
	return options;
}

/**
 * Given the path of an html file, this function will look in current directory & parent directories
 * to find a .htmlhintrc file to use as the linter configuration.  The settings are
 */
function findConfigForHtmlFile(base: string) {
	var options: any;

	if (fs.existsSync(base)) {

		// find default config file in parent directory
		if (fs.statSync(base).isDirectory() === false) {
			base = path.dirname(base);
		}

		while (base && !options) {
			var tmpConfigFile = path.resolve(base + path.sep, '.htmlhintrc');

			// undefined means we haven't tried to load the config file at this path, so try to load it.
			if (htmlhintrcOptions[tmpConfigFile] === undefined) {
				htmlhintrcOptions[tmpConfigFile] = loadConfigurationFile(tmpConfigFile);
			}

			// defined, non-null value means we found a config file at the given path, so use it.
			if (htmlhintrcOptions[tmpConfigFile]) {
				options = htmlhintrcOptions[tmpConfigFile];
				break;
			}

			base = base.substring(0, base.lastIndexOf(path.sep));
		}
	}
	return options;
}


/**
* Given an htmlhint Error object, approximate the text range highlight
*/
function getRange(error: htmlhint.Error, lines: string[]): any {

	let line = lines[error.line - 1];
	var isWhitespace = false;
	var curr = error.col;
	while (curr < line.length && !isWhitespace) {
		var char = line[curr];
		isWhitespace = (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '<');
		++curr;
	}

	if (isWhitespace) {
		--curr;
	}

	return {
		start: {
			line: error.line - 1, // Html-hint line numbers are 1-based.
			character: error.col - 1
		},
		end: {
			line: error.line - 1,
			character: curr
		}
	};
}

/**
 * Given an htmlhint.Error type return a VS Code server Diagnostic object
 */
function makeDiagnostic(problem: htmlhint.Error, lines: string[]): Diagnostic {

	return {
		severity: DiagnosticSeverity.Error,
		message: problem.message,
		range: getRange(problem, lines),
		code: problem.rule.id
	};
}

function doValidate(connection: IConnection, document: TextDocument): void {
	let uri = document.uri;
	if (htmlHintClient) {
		try {
			let fsPath = URI.parse(document.uri).fsPath;
			let contents = document.getText();
			let lines = contents.split('\n');

			let config = Object.assign({}, defaultLinterConfig, getConfiguration(fsPath)); //;

			let errors: htmlhint.Error[] = htmlHintClient.verify(contents, config);

			let diagnostics: Diagnostic[] = [];
			if (errors.length > 0) {
				errors.forEach(each => {
					diagnostics.push(makeDiagnostic(each, lines));
				});
			}
			connection.sendDiagnostics({ uri, diagnostics });
		} catch (err) {
			let message: string;
			if (typeof err.message === 'string' || err.message instanceof String) {
				message = <string>err.message;
				throw new Error(message);
			}
			throw err;
		}
	} else {
		connection.sendDiagnostics({ uri, diagnostics: [] });
	}
}

function validateAllTextDocuments(connection: IConnection, documents: TextDocument[]): void {
	let tracker = new ErrorMessageTracker();
	documents.forEach(document => {
		try {
			validateTextDocument(connection, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
}
export function disableLinting(connection: IConnection, documents: TextDocuments) {
	htmlHintClient = null;
	let tracker = new ErrorMessageTracker();
	documents.all().forEach(document => {
		try {
			validateTextDocument(connection, document);
		} catch (err) {
			tracker.add(getErrorMessage(err, document));
		}
	});
	tracker.sendErrors(connection);
	connection.onDidChangeWatchedFiles(() => { })
}

export function enableLinting(connection: IConnection, documents: TextDocuments) {
	htmlHintClient = require('htmlhint/dist/htmlhint').default;
	console.log(htmlHintClient);
	customRules.forEach(rule => htmlHintClient.addRule(rule));

	// The watched .htmlhintrc has changed. Clear out the last loaded config, and revalidate all documents.
	connection.onDidChangeWatchedFiles((params) => {
		for (var i = 0; i < params.changes.length; i++) {
			htmlhintrcOptions[URI.parse(params.changes[i].uri).fsPath] = undefined;
		}
		validateAllTextDocuments(connection, documents.all());
	})
}

export function onDidChangeConfiguration(connection: IConnection, documents: TextDocuments, params: DidChangeConfigurationParams) {

	settings = params.settings;
	if (
		settings &&
		settings.extension &&
		settings.extension.prophet &&
		settings.extension.prophet.htmlhint &&
		settings.extension.prophet.htmlhint.enabled &&
		!htmlHintClient
	) {
		enableLinting(connection, documents);
		connection.console.log('htmlhint enabled');
	} else if (
		settings &&
		settings.extension &&
		settings.extension.prophet &&
		settings.extension.prophet.htmlhint &&
		!settings.extension.prophet.htmlhint.enabled && htmlHintClient
	) {
		connection.console.log('htmlhint disabled');
		disableLinting(connection, documents);
	}
};
