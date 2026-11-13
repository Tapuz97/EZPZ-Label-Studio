import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrinterDuotoneIcon } from '@thesvg/ui-react/printer';

// Official theSVG duotone printer artwork, packaged locally under its MIT license.
const printer = renderToStaticMarkup(React.createElement(PrinterDuotoneIcon, { size: 340, color: '#ffffff' }));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="blue" x2="1" y2="1"><stop stop-color="#368de5"/><stop offset="1" stop-color="#184c8c"/></linearGradient></defs><rect x="16" y="16" width="480" height="480" rx="108" fill="url(#blue)"/><g transform="translate(86 86)">${printer}</g></svg>`;
fs.writeFileSync('public/app-icon.svg', svg);
