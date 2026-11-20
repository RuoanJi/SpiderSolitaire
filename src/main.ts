import { App } from './app';
import './styles.css';

const start = () => {
  (window as unknown as { spider: App }).spider = new App();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
