import DiscountCardList from "./components/DiscountCardList";
import { ThemeProvider } from "@/components/theme-provider"
import { ModeToggle } from "./components/mode-toggle";


function App() {
  return (
   
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <DiscountCardList />
      <ModeToggle />
  </ThemeProvider>
  );
}

export default App;
