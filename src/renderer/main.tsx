import { render } from 'preact';
import './ui/tokens.css';
import './ui/surfaces.css';
import './ui/base.css';
import { App } from './app/App';
import { boot } from './app/boot';

const root = document.getElementById('app');
if (root) render(<App />, root);
void boot();
