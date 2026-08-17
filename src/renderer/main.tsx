import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/app.css';

// Antes cada consulta se consideraba obsoleta al instante: entrar y salir
// de una pantalla, o simplemente volver a la ventana, relanzaba todas las
// consultas contra MySQL. Con estos valores la navegación reutiliza lo ya
// cargado y las pantallas que necesitan datos frescos siguen mandando
// (cada useQuery puede sobreescribir estas opciones).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
