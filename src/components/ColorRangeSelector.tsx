import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Download, Upload, RotateCcw, Palette, Crop, ZoomIn, Eye } from 'lucide-react';

interface ColorRangeSelectorProps {
  className?: string;
}

interface ColorInfo {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ColorRangeSelector: React.FC<ColorRangeSelectorProps> = ({ className }) => {
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [croppedImage, setCroppedImage] = useState<HTMLImageElement | null>(null);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [detectedColors, setDetectedColors] = useState<Array<{ color: string; count: number; rgb: ColorInfo }>>([]);
  const [tolerance, setTolerance] = useState<number>(30);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [showRedBackground, setShowRedBackground] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  const colorDistance = (color1: ColorInfo, color2: ColorInfo): number => {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const getPixelColor = (imageData: ImageData, x: number, y: number): ColorInfo => {
    const index = (y * imageData.width + x) * 4;
    return {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2],
      a: imageData.data[index + 3]
    };
  };

  const colorToString = (color: ColorInfo): string => {
    return `${color.r},${color.g},${color.b}`;
  };

  const analyzeImageColors = (img: HTMLImageElement) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsAnalyzing(true);

    // Use a smaller canvas for color analysis to improve performance
    const analysisCanvas = document.createElement('canvas');
    const analysisCtx = analysisCanvas.getContext('2d');
    if (!analysisCtx) return;

    // Scale down for analysis (max 200x200 for performance)
    const maxSize = 200;
    const ratio = Math.min(maxSize / img.width, maxSize / img.height);
    analysisCanvas.width = Math.floor(img.width * ratio);
    analysisCanvas.height = Math.floor(img.height * ratio);

    analysisCtx.drawImage(img, 0, 0, analysisCanvas.width, analysisCanvas.height);
    const imageData = analysisCtx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);

    // Count colors with quantization to group similar colors
    const colorMap = new Map<string, { count: number; rgb: ColorInfo }>();
    const quantize = 16; // Group colors into 16-color buckets

    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = Math.floor(imageData.data[i] / quantize) * quantize;
      const g = Math.floor(imageData.data[i + 1] / quantize) * quantize;
      const b = Math.floor(imageData.data[i + 2] / quantize) * quantize;
      const a = imageData.data[i + 3];

      // Skip transparent pixels
      if (a < 128) continue;

      const colorKey = `${r},${g},${b}`;
      
      if (colorMap.has(colorKey)) {
        colorMap.get(colorKey)!.count++;
      } else {
        colorMap.set(colorKey, {
          count: 1,
          rgb: { r, g, b, a: 255 }
        });
      }
    }

    // Sort colors by frequency and take top colors
    const sortedColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({
        color,
        count: data.count,
        rgb: data.rgb
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24); // Show top 24 colors

    setDetectedColors(sortedColors);
    setIsAnalyzing(false);
  };

  const getCanvasCoordinates = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const displayClickX = event.clientX - rect.left;
    const displayClickY = event.clientY - rect.top;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      display: { x: displayClickX, y: displayClickY },
      actual: { 
        x: Math.floor(displayClickX * scaleX), 
        y: Math.floor(displayClickY * scaleY) 
      }
    };
  };

  const drawCropOverlay = () => {
    const canvas = originalCanvasRef.current;
    if (!canvas || !cropArea) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw the original image first
    if (originalImage) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(originalImage, 0, 0, canvas.width, canvas.height);
    }

    // Draw crop overlay
    ctx.save();
    
    // Draw dark overlay over entire image
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Clear the crop area (make it bright)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    
    // Draw crop border
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    
    ctx.restore();
  };

  const applyCrop = () => {
    if (!originalImage || !cropArea) return;

    const croppedCanvas = document.createElement('canvas');
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to crop dimensions
    croppedCanvas.width = cropArea.width;
    croppedCanvas.height = cropArea.height;

    // Draw the cropped portion
    ctx.drawImage(
      originalImage,
      cropArea.x, cropArea.y, cropArea.width, cropArea.height,
      0, 0, cropArea.width, cropArea.height
    );

    // Convert to image
    croppedCanvas.toBlob((blob) => {
      if (!blob) return;
      
      const img = new Image();
      img.onload = () => {
        setCroppedImage(img);
        drawOriginalImage(img); // This will now draw the cropped image
        analyzeImageColors(img);
        setSelectedColors(new Set());
        setDetectedColors([]);
        
        // Exit crop mode
        setIsCropMode(false);
        setCropArea(null);
      };
      img.src = URL.createObjectURL(blob);
    });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('File selected:', file.name, file.type);

    const img = new Image();
    img.onload = () => {
      console.log('Image loaded successfully');
      setOriginalImage(img);
      setCroppedImage(null);
      setSelectedColors(new Set());
      setDetectedColors([]);
      setIsCropMode(false);
      setCropArea(null);
      
      // Use setTimeout to ensure the component has re-rendered with the new image
      setTimeout(() => {
        drawOriginalImage(img);
        analyzeImageColors(img);
      }, 0);
    };
    img.onerror = (error) => {
      console.error('Error loading image:', error);
    };
    img.src = URL.createObjectURL(file);
  };

  const drawOriginalImage = (img: HTMLImageElement) => {
    const canvas = originalCanvasRef.current;
    if (!canvas) {
      console.error('Canvas ref not found');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Canvas context not found');
      return;
    }

    // Set canvas size to match container max size while maintaining aspect ratio for DISPLAY
    const maxDisplayWidth = 450;
    const maxDisplayHeight = 350;
    const ratio = Math.min(maxDisplayWidth / img.width, maxDisplayHeight / img.height);
    
    const displayWidth = Math.floor(img.width * ratio);
    const displayHeight = Math.floor(img.height * ratio);
    
    // Set canvas internal resolution to ORIGINAL image size for high quality processing
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Set canvas display size to fit container
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    
    // Clear canvas first
    ctx.clearRect(0, 0, img.width, img.height);
    
    // Draw the image at FULL RESOLUTION
    ctx.drawImage(img, 0, 0, img.width, img.height);
    
    console.log('Image drawn:', { 
      originalSize: `${img.width}x${img.height}`, 
      displaySize: `${displayWidth}x${displayHeight}`,
      canvasInternalSize: `${canvas.width}x${canvas.height}`,
      canvasDisplaySize: `${canvas.style.width}x${canvas.style.height}`
    });
  };

  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (isCropMode) return; // Disable color selection in crop mode
    
    const canvas = originalCanvasRef.current;
    if (!canvas || !originalImage) return;

    const rect = canvas.getBoundingClientRect();
    
    // Calculate click position relative to the displayed canvas
    const displayClickX = event.clientX - rect.left;
    const displayClickY = event.clientY - rect.top;
    
    // Convert display coordinates to actual canvas coordinates
    // Since canvas internal size is full resolution but display is scaled
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const actualX = Math.floor(displayClickX * scaleX);
    const actualY = Math.floor(displayClickY * scaleY);
    
    // Ensure coordinates are within bounds
    const x = Math.max(0, Math.min(actualX, canvas.width - 1));
    const y = Math.max(0, Math.min(actualY, canvas.height - 1));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const clickedColor = getPixelColor(imageData, x, y);
    const colorString = colorToString(clickedColor);

    console.log('Click coordinates:', {
      display: `${displayClickX}, ${displayClickY}`,
      actual: `${x}, ${y}`,
      color: `rgb(${clickedColor.r}, ${clickedColor.g}, ${clickedColor.b})`
    });

    setSelectedColors(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(colorString)) {
        newSelected.delete(colorString);
      } else {
        newSelected.add(colorString);
      }
      return newSelected;
    });
  }, [originalImage, isCropMode]);

  const handleCanvasMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropMode) return;
    
    const coords = getCanvasCoordinates(event);
    if (!coords) return;

    setIsDrawing(true);
    setStartPoint(coords.actual);
    setCropArea(null);
  }, [isCropMode]);

  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isCropMode || !isDrawing || !startPoint) return;
    
    const coords = getCanvasCoordinates(event);
    if (!coords) return;

    const newCropArea = {
      x: Math.min(startPoint.x, coords.actual.x),
      y: Math.min(startPoint.y, coords.actual.y),
      width: Math.abs(coords.actual.x - startPoint.x),
      height: Math.abs(coords.actual.y - startPoint.y)
    };

    setCropArea(newCropArea);
  }, [isCropMode, isDrawing, startPoint]);

  const handleCanvasMouseUp = useCallback(() => {
    if (!isCropMode) return;
    setIsDrawing(false);
  }, [isCropMode]);

  const processImage = useCallback(() => {
    const workingImage = croppedImage || originalImage;
    if (!workingImage || selectedColors.size === 0) return;

    setIsProcessing(true);
    
    setTimeout(() => {
      const originalCanvas = originalCanvasRef.current;
      const resultCanvas = resultCanvasRef.current;
      
      if (!originalCanvas || !resultCanvas) {
        setIsProcessing(false);
        return;
      }

      const originalCtx = originalCanvas.getContext('2d');
      const resultCtx = resultCanvas.getContext('2d');
      
      if (!originalCtx || !resultCtx) {
        setIsProcessing(false);
        return;
      }

      // Set result canvas to FULL RESOLUTION (same as working image)
      resultCanvas.width = originalCanvas.width;
      resultCanvas.height = originalCanvas.height;
      
      // Set result canvas DISPLAY size to match original canvas display
      resultCanvas.style.width = originalCanvas.style.width;
      resultCanvas.style.height = originalCanvas.style.height;

      console.log('Processing at full resolution:', {
        size: `${resultCanvas.width}x${resultCanvas.height}`,
        displaySize: `${resultCanvas.style.width}x${resultCanvas.style.height}`,
        workingImage: croppedImage ? 'cropped' : 'original',
        redBackground: showRedBackground
      });

      // Clear canvas first
      resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

      // Fill with red background if enabled
      if (showRedBackground) {
        resultCtx.fillStyle = '#ff0000';
        resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
      }

      const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
      const resultData = resultCtx.createImageData(imageData.width, imageData.height);

      // Convert selected colors to ColorInfo objects
      const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      // Process each pixel at full resolution
      for (let i = 0; i < imageData.data.length; i += 4) {
        const pixelColor = {
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        };

        let isSelected = false;
        
        // Check if pixel color matches any selected color within tolerance
        for (const selectedColor of selectedColorObjects) {
          if (colorDistance(pixelColor, selectedColor) <= tolerance) {
            isSelected = true;
            break;
          }
        }

        if (isSelected) {
          // Keep the original color
          resultData.data[i] = imageData.data[i];     // R
          resultData.data[i + 1] = imageData.data[i + 1]; // G
          resultData.data[i + 2] = imageData.data[i + 2]; // B
          resultData.data[i + 3] = imageData.data[i + 3]; // A
        } else if (showRedBackground) {
          // Set to red background
          resultData.data[i] = 255;     // R
          resultData.data[i + 1] = 0;   // G
          resultData.data[i + 2] = 0;   // B
          resultData.data[i + 3] = 255; // A (opaque)
        } else {
          // Make transparent
          resultData.data[i] = 0;     // R
          resultData.data[i + 1] = 0; // G
          resultData.data[i + 2] = 0; // B
          resultData.data[i + 3] = 0; // A (transparent)
        }
      }

      resultCtx.putImageData(resultData, 0, 0);
      setIsProcessing(false);
    }, 100);
  }, [croppedImage, originalImage, selectedColors, tolerance, showRedBackground]);

  const downloadResult = () => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;

    console.log('Processing download with auto-crop...');

    // Create a temporary canvas to generate transparent version for download
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    // Regenerate the image data with transparency (ignore red background setting for download)
    const originalCanvas = originalCanvasRef.current;
    if (!originalCanvas) return;

    const originalCtx = originalCanvas.getContext('2d');
    if (!originalCtx) return;

    const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    const resultData = tempCtx.createImageData(imageData.width, imageData.height);

    // Convert selected colors to ColorInfo objects
    const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
      const [r, g, b] = colorStr.split(',').map(Number);
      return { r, g, b, a: 255 };
    });

    // Process each pixel for transparent download
    for (let i = 0; i < imageData.data.length; i += 4) {
      const pixelColor = {
        r: imageData.data[i],
        g: imageData.data[i + 1],
        b: imageData.data[i + 2],
        a: imageData.data[i + 3]
      };

      let isSelected = false;
      
      // Check if pixel color matches any selected color within tolerance
      for (const selectedColor of selectedColorObjects) {
        if (colorDistance(pixelColor, selectedColor) <= tolerance) {
          isSelected = true;
          break;
        }
      }

      if (isSelected) {
        // Keep the original color
        resultData.data[i] = imageData.data[i];     // R
        resultData.data[i + 1] = imageData.data[i + 1]; // G
        resultData.data[i + 2] = imageData.data[i + 2]; // B
        resultData.data[i + 3] = imageData.data[i + 3]; // A
      } else {
        // Make transparent
        resultData.data[i] = 0;     // R
        resultData.data[i + 1] = 0; // G
        resultData.data[i + 2] = 0; // B
        resultData.data[i + 3] = 0; // A (transparent)
      }
    }

    tempCtx.putImageData(resultData, 0, 0);

    // Now find bounding box of non-transparent pixels
    let minX = tempCanvas.width;
    let minY = tempCanvas.height;
    let maxX = 0;
    let maxY = 0;
    let hasContent = false;

    for (let y = 0; y < tempCanvas.height; y++) {
      for (let x = 0; x < tempCanvas.width; x++) {
        const index = (y * tempCanvas.width + x) * 4;
        const alpha = resultData.data[index + 3];
        
        if (alpha > 0) { // Non-transparent pixel
          hasContent = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!hasContent) {
      console.log('No content to download');
      return;
    }

    // Calculate crop dimensions with some padding
    const padding = 2;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropWidth = Math.min(tempCanvas.width - cropX, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(tempCanvas.height - cropY, maxY - minY + 1 + padding * 2);

    // Create a new canvas with the cropped dimensions
    const croppedCanvas = document.createElement('canvas');
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) return;

    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;

    // Copy the cropped area
    const croppedImageData = tempCtx.getImageData(cropX, cropY, cropWidth, cropHeight);
    croppedCtx.putImageData(croppedImageData, 0, 0);

    console.log('Auto-crop details:', {
      original: `${tempCanvas.width}x${tempCanvas.height}`,
      cropped: `${cropWidth}x${cropHeight}`,
      bounds: { minX, minY, maxX, maxY },
      reduction: `${((1 - (cropWidth * cropHeight) / (tempCanvas.width * tempCanvas.height)) * 100).toFixed(1)}% smaller`
    });

    croppedCanvas.toBlob((blob) => {
      if (!blob) return;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `color-selection-cropped-${cropWidth}x${cropHeight}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('Downloaded auto-cropped PNG:', {
        resolution: `${cropWidth}x${cropHeight}`,
        fileSize: `${(blob.size / 1024 / 1024).toFixed(2)} MB`
      });
    }, 'image/png');
  };

  const resetSelection = () => {
    setSelectedColors(new Set());
    const resultCanvas = resultCanvasRef.current;
    if (resultCanvas) {
      const ctx = resultCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      }
    }
  };

  const toggleColorSelection = (colorString: string) => {
    setSelectedColors(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(colorString)) {
        newSelected.delete(colorString);
      } else {
        newSelected.add(colorString);
      }
      return newSelected;
    });
  };

  const selectAllColors = () => {
    const allColors = new Set(detectedColors.map(c => c.color));
    setSelectedColors(allColors);
  };

  const deselectAllColors = () => {
    setSelectedColors(new Set());
  };

  // Auto-process when selection or tolerance changes
  useEffect(() => {
    if (selectedColors.size > 0) {
      processImage();
    }
  }, [selectedColors, tolerance, processImage]);

  // Redraw image when canvas ref becomes available
  useEffect(() => {
    if (originalImage && originalCanvasRef.current) {
      const imageToUse = croppedImage || originalImage;
      drawOriginalImage(imageToUse);
      analyzeImageColors(imageToUse);
    }
  }, [originalImage, croppedImage]);

  // Draw crop overlay when crop area changes
  useEffect(() => {
    if (isCropMode && cropArea) {
      drawCropOverlay();
    }
  }, [cropArea, isCropMode]);

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 space-y-6 ${className || ''}`}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Color Range Selection Tool
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload Section */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            
            {originalImage && (
              <div className="text-sm text-green-600 flex items-center gap-4">
                <span>✓ Image loaded ({(croppedImage || originalImage).width}×{(croppedImage || originalImage).height})</span>
                <span className="text-gray-500">
                  {croppedImage ? 'Cropped view' : 'Full resolution preserved for output'}
                </span>
              </div>
            )}
            
            {originalImage && (
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsCropMode(!isCropMode)}
                  variant={isCropMode ? "default" : "outline"}
                  size="sm"
                  className="flex items-center gap-1"
                >
                  <Crop className="w-3 h-3" />
                  {isCropMode ? 'Exit Crop' : 'Crop Area'}
                </Button>
                
                {cropArea && isCropMode && (
                  <Button
                    onClick={applyCrop}
                    size="sm"
                    className="flex items-center gap-1"
                  >
                    <ZoomIn className="w-3 h-3" />
                    Apply Crop
                  </Button>
                )}
                
                {croppedImage && (
                  <Button
                    onClick={() => {
                      setCroppedImage(null);
                      setIsCropMode(false);
                      setCropArea(null);
                      setSelectedColors(new Set());
                      setDetectedColors([]);
                      if (originalImage) {
                        setTimeout(() => {
                          drawOriginalImage(originalImage);
                          analyzeImageColors(originalImage);
                        }, 0);
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to Original
                  </Button>
                )}
              </div>
            )}
            
            {selectedColors.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {selectedColors.size} color{selectedColors.size !== 1 ? 's' : ''} selected
                </span>
                <Button
                  onClick={resetSelection}
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </Button>
              </div>
            )}
          </div>

          {/* Crop Mode Instructions */}
          {isCropMode && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-blue-800">
                <Crop className="w-4 h-4" />
                <span className="font-medium">Crop Mode Active</span>
              </div>
              <p className="text-sm text-blue-700 mt-1">
                Click and drag on the image to select an area to crop. 
                {cropArea && ' Click "Apply Crop" to zoom into the selected area.'}
              </p>
            </div>
          )}

          {/* Tolerance Control */}
          {originalImage && (
            <div className="flex items-center gap-4">
              <label htmlFor="tolerance" className="text-sm font-medium">
                Tolerance:
              </label>
              <input
                id="tolerance"
                type="range"
                min="0"
                max="100"
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
                className="w-32"
              />
              <span className="text-sm text-gray-600 w-8">{tolerance}</span>
            </div>
          )}

          {/* Preview Options */}
          {selectedColors.size > 0 && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRedBackground}
                  onChange={(e) => setShowRedBackground(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Eye className="w-4 h-4" />
                Show red contrast background
              </label>
              <span className="text-xs text-gray-500">
                (Preview only - download will be transparent)
              </span>
            </div>
          )}

          {/* Color Swatches */}
          {detectedColors.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Detected Colors</h3>
                <div className="flex gap-2">
                  <Button
                    onClick={selectAllColors}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Select All
                  </Button>
                  <Button
                    onClick={deselectAllColors}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Click on color swatches to select/deselect them for the output
              </p>
              
              {isAnalyzing ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-sm text-gray-500">Analyzing colors...</div>
                </div>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                  {detectedColors.map((colorData, index) => {
                    const isSelected = selectedColors.has(colorData.color);
                    const [r, g, b] = colorData.color.split(',').map(Number);
                    
                    return (
                      <button
                        key={index}
                        onClick={() => toggleColorSelection(colorData.color)}
                        className={`
                          relative w-12 h-12 rounded-lg border-2 transition-all duration-200 hover:scale-110
                          ${isSelected 
                            ? 'border-blue-500 ring-2 ring-blue-200' 
                            : 'border-gray-300 hover:border-gray-400'
                          }
                        `}
                        style={{ 
                          backgroundColor: `rgb(${r}, ${g}, ${b})`,
                        }}
                        title={`RGB(${r}, ${g}, ${b}) - ${colorData.count} pixels`}
                      >
                        {isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-3 h-3 bg-white rounded-full border border-gray-300 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              
              {selectedColors.size > 0 && (
                <div className="text-sm text-gray-600">
                  {selectedColors.size} of {detectedColors.length} colors selected
                </div>
              )}
            </div>
          )}

          {/* Canvas Section */}
          {originalImage && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Original Image */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {croppedImage ? 'Cropped Area' : 'Original Image'}
                </h3>
                <p className="text-sm text-gray-600">
                  {isCropMode 
                    ? 'Draw a rectangle to select crop area' 
                    : 'Click on colors to select them'
                  }
                </p>
                <div className="border-2 border-gray-300 rounded-lg p-4 bg-white min-h-[300px] flex items-center justify-center">
                  {originalImage ? (
                    <canvas
                      ref={originalCanvasRef}
                      onClick={handleCanvasClick}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      className={`border border-gray-200 rounded shadow-sm ${
                        isCropMode ? 'cursor-crosshair' : 'cursor-pointer'
                      }`}
                      style={{ 
                        maxWidth: '100%',
                        height: 'auto',
                        display: 'block',
                        imageRendering: 'auto' // Use auto for better quality scaling
                      }}
                    />
                  ) : (
                    <div className="text-gray-400 text-center">
                      <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Upload an image to get started</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Result Image */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Selection Result</h3>
                    <p className="text-sm text-gray-600">Selected colors with transparent background</p>
                  </div>
                  {selectedColors.size > 0 && (
                    <Button
                      onClick={downloadResult}
                      disabled={isProcessing}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download PNG
                    </Button>
                  )}
                </div>
                <div className={`border-2 border-gray-300 rounded-lg p-4 min-h-[300px] flex items-center justify-center ${
                  showRedBackground 
                    ? 'bg-red-500' 
                    : 'bg-white bg-opacity-50 bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%),linear-gradient(-45deg,#f0f0f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0f0f0_75%),linear-gradient(-45deg,transparent_75%,#f0f0f0_75%)] bg-[length:20px_20px] bg-[0_0,0_10px,10px_-10px,-10px_0px]'
                }`}>
                  {selectedColors.size > 0 ? (
                    <div className="relative">
                      <canvas
                        ref={resultCanvasRef}
                        className="border border-gray-200 rounded shadow-sm"
                        style={{ 
                          maxWidth: '100%',
                          height: 'auto',
                          display: 'block',
                          imageRendering: 'auto' // Use auto for better quality scaling
                        }}
                      />
                      {isProcessing && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75 rounded">
                          <div className="text-sm">Processing...</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-gray-400 text-center">
                      <Palette className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Result will appear here</p>
                      <p className="text-sm">Click on colors in the original image to select them</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Instructions */}
          {!originalImage && (
            <div className="text-center py-12 text-gray-500">
              <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Upload an image to get started</p>
              <p className="text-sm">Click on colors in the image to select them</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ColorRangeSelector;
