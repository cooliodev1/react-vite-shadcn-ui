import "./styles/globals.css"
import ColorRangeSelector from "./components/ColorRangeSelector"

function App() {
  return (
   <div className="min-h-screen bg-gray-50 py-8">
     <div className="container mx-auto">
       <h1 className="text-3xl font-bold text-center mb-8">Color Range Selection Tool</h1>
       <ColorRangeSelector />
     </div>
   </div>
  )
}

export default App;
