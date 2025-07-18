import "./styles/globals.css"
import ColorRangeSelector from "./components/ColorRangeSelector"
import ImageUploader from "./components/ImageUploader"
import { useRef } from "react"

function App() {
  const colorRangeSelectorRef = useRef<{ handleExternalImage: (img: HTMLImageElement) => void }>(null);

  // Handle image change from ImageUploader
  const handleImageChange = (src: string) => {
    console.log('Image changed:', src);
    
    // Create an image element and trigger the same process as file upload
    if (src) {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Handle CORS for external URLs
      img.onload = () => {
        // Trigger the same process as the file upload in ColorRangeSelector
        if (colorRangeSelectorRef.current) {
          colorRangeSelectorRef.current.handleExternalImage(img);
        }
      };
      img.onerror = (error) => {
        console.error('Error loading image:', error);
        alert('Failed to load image. Please check the URL or try a different image.');
      };
      img.src = src;
    }
  };

  return (
   <div className="min-h-screen bg-gray-50 py-8">
     <div className="container mx-auto">
       <h1 className="text-3xl font-bold text-center mb-8">Color Range Selection Tool</h1>
       
       {/* Image Uploader Section */}
       <div className="mb-12">
         <h2 className="text-2xl font-semibold text-center mb-6">Image Uploader</h2>
         <ImageUploader onImageChange={handleImageChange} />
       </div>
       
       {/* Color Range Selector */}
       <div>
         <h2 className="text-2xl font-semibold text-center mb-6">Color Range Selector</h2>
         <ColorRangeSelector ref={colorRangeSelectorRef} />
       </div>
     </div>
   </div>
  )
}

export default App;
