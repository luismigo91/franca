import { HomeScreen } from '@/components/chat/home-screen';

// La página no lee datos (D1): la pantalla del navegador los pide a las rutas de la web, así que ni el prerender ni
// la caché del router pueden servir datos viejos.
export default function Page() {
  return <HomeScreen />;
}
