import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Download, Upload, RotateCcw, Palette, Crop, ZoomIn, Eye, Moon, Sun, Circle } from 'lucide-react';

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
  const [tolerance, setTolerance] = useState<number>(25);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [showRedBackground, setShowRedBackground] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [cropMode, setCropMode] = useState<'rectangle' | 'circle'>('rectangle');
  const [activeCircularMask, setActiveCircularMask] = useState<{ centerX: number; centerY: number; radius: number } | null>(null);
  const [desaturateResult, setDesaturateResult] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  const colorDistance = (color1: ColorInfo, color2: ColorInfo): number => {
    // Use weighted Euclidean distance that better matches human perception
    // Red and green differences are weighted more heavily than blue
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    
    // Weights based on human eye sensitivity
    const weightR = 0.3;
    const weightG = 0.59;
    const weightB = 0.11;
    
    return Math.sqrt(weightR * dr * dr + weightG * dg * dg + weightB * db * db);
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

  // Helper function to desaturate a color (convert to grayscale)
  const desaturateColor = (r: number, g: number, b: number): { r: number; g: number; b: number } => {
    // Using luminance formula for better grayscale conversion
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    return { r: gray, g: gray, b: gray };
  };

  // Helper function to calculate color brightness (luminance)
  const getColorBrightness = (r: number, g: number, b: number): number => {
    // Using relative luminance formula
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  // Helper function to calculate color saturation
  const getColorSaturation = (r: number, g: number, b: number): number => {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    return max === 0 ? 0 : (max - min) / max;
  };

  // Helper function to classify colors
  const classifyColor = (r: number, g: number, b: number) => {
    const brightness = getColorBrightness(r, g, b);
    const saturation = getColorSaturation(r, g, b);
    
    const isDark = brightness < 0.3;
    const isLight = brightness > 0.7;
    const isColorful = saturation > 0.3; // Has significant color content
    
    return { isDark, isLight, isColorful, brightness, saturation };
  };

  // Filter functions for color selection
  const selectColorsByFilter = (filterType: 'dark' | 'light' | 'colorful' | 'all', action: 'select' | 'deselect') => {
    const filteredColors = detectedColors.filter(colorData => {
      const [r, g, b] = colorData.color.split(',').map(Number);
      const { isDark, isLight, isColorful } = classifyColor(r, g, b);
      
      switch (filterType) {
        case 'dark':
          return isDark;
        case 'light':
          return isLight;
        case 'colorful':
          return isColorful;
        case 'all':
          return true;
        default:
          return false;
      }
    });

    setSelectedColors(prev => {
      const newSelected = new Set(prev);
      
      filteredColors.forEach(colorData => {
        if (action === 'select') {
          newSelected.add(colorData.color);
        } else {
          newSelected.delete(colorData.color);
        }
      });
      
      // Immediately process with the current circular mask
      setTimeout(() => {
        if (newSelected.size > 0) {
          processImage(activeCircularMask || undefined);
        }
      }, 0);
      
      return newSelected;
    });
  };

  // Contrast-based circle detection algorithm - REMOVED
  // Using manual circle selection with arrow key movement instead

  const analyzeImageColors = (img: HTMLImageElement, circularMask?: { centerX: number; centerY: number; radius: number }) => {
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

    // Scale the circular mask to match the analysis canvas
    let scaledMask: { centerX: number; centerY: number; radius: number } | undefined;
    if (circularMask) {
      scaledMask = {
        centerX: circularMask.centerX * ratio,
        centerY: circularMask.centerY * ratio,
        radius: circularMask.radius * ratio
      };
    }

    // Count colors with improved quantization that preserves red/orange distinctions
    const colorMap = new Map<string, { count: number; rgb: ColorInfo }>();
    
    // Use adaptive quantization - less aggressive for warm colors (red, orange, yellow)
    const getQuantizationLevel = (r: number, g: number, b: number): number => {
      // Check if this is a warm color (red, orange, yellow)
      const isWarmColor = r > g && r > b; // Red dominant
      const isOrange = r > 150 && g > 50 && g < 200 && b < 150; // Orange range
      const isYellow = r > 200 && g > 200 && b < 150; // Yellow range
      
      if (isWarmColor || isOrange || isYellow) {
        return 8; // Less aggressive quantization for warm colors
      }
      return 16; // Standard quantization for other colors
    };

    for (let y = 0; y < analysisCanvas.height; y++) {
      for (let x = 0; x < analysisCanvas.width; x++) {
        const i = (y * analysisCanvas.width + x) * 4;
        
        // Check if pixel is within circular mask (if provided)
        if (scaledMask) {
          const dx = x - scaledMask.centerX;
          const dy = y - scaledMask.centerY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > scaledMask.radius) {
            continue; // Skip pixels outside the circle
          }
        }
        
        const originalR = imageData.data[i];
        const originalG = imageData.data[i + 1];
        const originalB = imageData.data[i + 2];
        const a = imageData.data[i + 3];

        // Skip transparent pixels
        if (a < 128) continue;

        const quantize = getQuantizationLevel(originalR, originalG, originalB);
        const r = Math.floor(originalR / quantize) * quantize;
        const g = Math.floor(originalG / quantize) * quantize;
        const b = Math.floor(originalB / quantize) * quantize;

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
    }

    // Sort colors by frequency and take top colors
    const sortedColors = Array.from(colorMap.entries())
      .map(([color, data]) => ({
        color,
        count: data.count,
        rgb: data.rgb
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 32); // Show top 32 colors to capture more color variations

    console.log('Detected colors:', sortedColors.map(c => ({
      color: c.color,
      count: c.count,
      isWarm: c.rgb.r > c.rgb.g && c.rgb.r > c.rgb.b,
      isRed: c.rgb.r > 150 && c.rgb.g < 100 && c.rgb.b < 100,
      isOrange: c.rgb.r > 150 && c.rgb.g > 50 && c.rgb.g < 200 && c.rgb.b < 150
    })));

    if (circularMask) {
      console.log('Color analysis within circle:', {
        center: `(${Math.round(circularMask.centerX)}, ${Math.round(circularMask.centerY)})`,
        radius: Math.round(circularMask.radius),
        colorsFound: sortedColors.length
      });
    }

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

    // Redraw the current working image first (cropped or original)
    const workingImage = croppedImage || originalImage;
    if (workingImage) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(workingImage, 0, 0, canvas.width, canvas.height);
    }

    // Draw crop overlay
    ctx.save();
    
    // Draw dark overlay over entire image
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Clear the crop area (make it bright)
    ctx.globalCompositeOperation = 'destination-out';
    
    if (cropMode === 'rectangle') {
      ctx.fillRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    } else if (cropMode === 'circle') {
      // For circle, clear a circular area
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
    
    // Draw crop border
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    
    if (cropMode === 'rectangle') {
      ctx.strokeRect(cropArea.x, cropArea.y, cropArea.width, cropArea.height);
    } else if (cropMode === 'circle') {
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    
    ctx.restore();

    // Update active circular mask if in circle mode (but don't trigger immediate re-analysis)
    if (cropMode === 'circle') {
      const centerX = cropArea.x + cropArea.width / 2;
      const centerY = cropArea.y + cropArea.height / 2;
      const radius = Math.min(cropArea.width, cropArea.height) / 2;
      
      const newMask = { centerX, centerY, radius };
      
      // Only update if the mask has actually changed to prevent unnecessary re-renders
      setActiveCircularMask(prevMask => {
        if (!prevMask || 
            Math.abs(prevMask.centerX - newMask.centerX) > 1 ||
            Math.abs(prevMask.centerY - newMask.centerY) > 1 ||
            Math.abs(prevMask.radius - newMask.radius) > 1) {
          return newMask;
        }
        return prevMask;
      });
    } else {
      setActiveCircularMask(null);
    }
  };

  // Circle detection removed - using manual circle positioning with arrow keys

  const applyCrop = () => {
    const workingImage = croppedImage || originalImage;
    if (!workingImage || !cropArea) return;

    const croppedCanvas = document.createElement('canvas');
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to crop dimensions
    croppedCanvas.width = cropArea.width;
    croppedCanvas.height = cropArea.height;

    // Draw the cropped portion from the current working image
    ctx.drawImage(
      workingImage,
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
      setActiveCircularMask(null);
      
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
      
      // Immediately process with the current circular mask
      setTimeout(() => {
        if (newSelected.size > 0) {
          processImage(activeCircularMask || undefined);
        }
      }, 0);
      
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

    if (cropMode === 'rectangle') {
      const newCropArea = {
        x: Math.min(startPoint.x, coords.actual.x),
        y: Math.min(startPoint.y, coords.actual.y),
        width: Math.abs(coords.actual.x - startPoint.x),
        height: Math.abs(coords.actual.y - startPoint.y)
      };
      setCropArea(newCropArea);
    } else if (cropMode === 'circle') {
      // For circle, calculate radius from center to current point
      const dx = coords.actual.x - startPoint.x;
      const dy = coords.actual.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      
      // Create a square crop area that contains the circle
      const newCropArea = {
        x: Math.max(0, startPoint.x - radius),
        y: Math.max(0, startPoint.y - radius),
        width: radius * 2,
        height: radius * 2
      };
      setCropArea(newCropArea);
    }
  }, [isCropMode, isDrawing, startPoint, cropMode]);

  const handleCanvasMouseUp = useCallback(() => {
    if (!isCropMode) return;
    setIsDrawing(false);
  }, [isCropMode]);

  const processImage = useCallback((circularMask?: { centerX: number; centerY: number; radius: number }) => {
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

      // If we have a circular mask, size the result canvas to the circle
      if (circularMask) {
        const { centerX, centerY, radius } = circularMask;
        
        // Calculate the square bounds that contain the circle
        const cropX = Math.max(0, Math.floor(centerX - radius));
        const cropY = Math.max(0, Math.floor(centerY - radius));
        const cropSize = Math.ceil(radius * 2);
        
        // Set result canvas to circle size
        resultCanvas.width = cropSize;
        resultCanvas.height = cropSize;
        
        // Calculate display size maintaining aspect ratio
        const maxDisplayWidth = 450;
        const maxDisplayHeight = 350;
        const displayRatio = Math.min(maxDisplayWidth / cropSize, maxDisplayHeight / cropSize);
        
        const displayWidth = Math.floor(cropSize * displayRatio);
        const displayHeight = Math.floor(cropSize * displayRatio);
        
        resultCanvas.style.width = `${displayWidth}px`;
        resultCanvas.style.height = `${displayHeight}px`;
        
        console.log('Processing circular crop at full resolution:', {
          circleSize: `${cropSize}x${cropSize}`,
          displaySize: `${displayWidth}x${displayHeight}`,
          center: `(${Math.round(centerX)}, ${Math.round(centerY)})`,
          radius: Math.round(radius)
        });

        // Clear canvas
        resultCtx.clearRect(0, 0, cropSize, cropSize);

        // Fill with red background if enabled
        if (showRedBackground) {
          resultCtx.fillStyle = '#ff0000';
          resultCtx.fillRect(0, 0, cropSize, cropSize);
        }

        // Get the original image data (without any overlays)
        const originalImageToUse = croppedImage || originalImage;
        if (!originalImageToUse) {
          setIsProcessing(false);
          return;
        }

        // Create a clean canvas with just the original image data
        const cleanCanvas = document.createElement('canvas');
        const cleanCtx = cleanCanvas.getContext('2d');
        if (!cleanCtx) {
          setIsProcessing(false);
          return;
        }

        cleanCanvas.width = originalCanvas.width;
        cleanCanvas.height = originalCanvas.height;
        cleanCtx.drawImage(originalImageToUse, 0, 0, cleanCanvas.width, cleanCanvas.height);
        
        const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
        const resultData = resultCtx.createImageData(cropSize, cropSize);

        // Convert selected colors to ColorInfo objects
        const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
          const [r, g, b] = colorStr.split(',').map(Number);
          return { r, g, b, a: 255 };
        });

        // Calculate the circle center relative to the cropped area
        const relativeCenterX = centerX - cropX;
        const relativeCenterY = centerY - cropY;

        // Process each pixel in the circular area
        for (let y = 0; y < cropSize; y++) {
          for (let x = 0; x < cropSize; x++) {
            const resultIndex = (y * cropSize + x) * 4;
            
            // Calculate distance from circle center
            const dx = x - relativeCenterX;
            const dy = y - relativeCenterY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Check if pixel is within the circle
            if (distance <= radius) {
              // Get the original image coordinates
              const originalX = cropX + x;
              const originalY = cropY + y;
              
              // Make sure we're within the original image bounds
              if (originalX >= 0 && originalX < originalCanvas.width && 
                  originalY >= 0 && originalY < originalCanvas.height) {
                
                const originalIndex = (originalY * originalCanvas.width + originalX) * 4;
                
                const pixelColor = {
                  r: imageData.data[originalIndex],
                  g: imageData.data[originalIndex + 1],
                  b: imageData.data[originalIndex + 2],
                  a: imageData.data[originalIndex + 3]
                };

                let isSelected = false;
                let minDistance = Infinity;
                
                // Check if pixel color matches any selected color within tolerance
                for (const selectedColor of selectedColorObjects) {
                  const dist = colorDistance(pixelColor, selectedColor);
                  minDistance = Math.min(minDistance, dist);
                  if (dist <= tolerance) {
                    isSelected = true;
                    break;
                  }
                }

                if (isSelected) {
                  // Keep the original color with full opacity (or desaturated if enabled)
                  if (desaturateResult) {
                    const desaturated = desaturateColor(
                      imageData.data[originalIndex],
                      imageData.data[originalIndex + 1],
                      imageData.data[originalIndex + 2]
                    );
                    resultData.data[resultIndex] = desaturated.r;
                    resultData.data[resultIndex + 1] = desaturated.g;
                    resultData.data[resultIndex + 2] = desaturated.b;
                    resultData.data[resultIndex + 3] = 255; // Full opacity
                  } else {
                    resultData.data[resultIndex] = imageData.data[originalIndex];
                    resultData.data[resultIndex + 1] = imageData.data[originalIndex + 1];
                    resultData.data[resultIndex + 2] = imageData.data[originalIndex + 2];
                    resultData.data[resultIndex + 3] = 255; // Full opacity
                  }
                } else if (showRedBackground) {
                  // Show red background for unselected pixels
                  const isCloseToRedOrange = selectedColorObjects.some(selectedColor => {
                    const isRedOrangeSelected = selectedColor.r > selectedColor.g && selectedColor.r > selectedColor.b;
                    return isRedOrangeSelected && minDistance < tolerance * 1.5;
                  });
                  
                  if (isCloseToRedOrange) {
                    resultData.data[resultIndex] = 0;     // Black background
                    resultData.data[resultIndex + 1] = 0;
                    resultData.data[resultIndex + 2] = 0;
                    resultData.data[resultIndex + 3] = 255;
                  } else {
                    resultData.data[resultIndex] = 255;   // Red background
                    resultData.data[resultIndex + 1] = 0;
                    resultData.data[resultIndex + 2] = 0;
                    resultData.data[resultIndex + 3] = 255;
                  }
                } else {
                  // Make transparent
                  resultData.data[resultIndex] = 0;
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 0;
                }
              } else {
                // Outside original image bounds
                if (showRedBackground) {
                  resultData.data[resultIndex] = 255;   // Red background
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 255;
                } else {
                  resultData.data[resultIndex] = 0;
                  resultData.data[resultIndex + 1] = 0;
                  resultData.data[resultIndex + 2] = 0;
                  resultData.data[resultIndex + 3] = 0;
                }
              }
            } else {
              // Outside circle - make transparent
              resultData.data[resultIndex] = 0;
              resultData.data[resultIndex + 1] = 0;
              resultData.data[resultIndex + 2] = 0;
              resultData.data[resultIndex + 3] = 0;
            }
          }
        }

        resultCtx.putImageData(resultData, 0, 0);
        setIsProcessing(false);
        return;
      }

      // Original rectangular processing
      resultCanvas.width = originalCanvas.width;
      resultCanvas.height = originalCanvas.height;
      
      resultCanvas.style.width = originalCanvas.style.width;
      resultCanvas.style.height = originalCanvas.style.height;

      console.log('Processing at full resolution:', {
        size: `${resultCanvas.width}x${resultCanvas.height}`,
        displaySize: `${resultCanvas.style.width}x${resultCanvas.style.height}`,
        workingImage: croppedImage ? 'cropped' : 'original',
        redBackground: showRedBackground
      });

      resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

      if (showRedBackground) {
        resultCtx.fillStyle = '#ff0000';
        resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
      }

      const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
      const resultData = resultCtx.createImageData(imageData.width, imageData.height);

      const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      for (let y = 0; y < imageData.height; y++) {
        for (let x = 0; x < imageData.width; x++) {
          const i = (y * imageData.width + x) * 4;
          
          const pixelColor = {
            r: imageData.data[i],
            g: imageData.data[i + 1],
            b: imageData.data[i + 2],
            a: imageData.data[i + 3]
          };

          let isSelected = false;
          let minDistance = Infinity;
          
          for (const selectedColor of selectedColorObjects) {
            const distance = colorDistance(pixelColor, selectedColor);
            minDistance = Math.min(minDistance, distance);
            if (distance <= tolerance) {
              isSelected = true;
              break;
            }
          }

          if (isSelected) {
            if (desaturateResult) {
              const desaturated = desaturateColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
              resultData.data[i] = desaturated.r;
              resultData.data[i + 1] = desaturated.g;
              resultData.data[i + 2] = desaturated.b;
              resultData.data[i + 3] = imageData.data[i + 3];
            } else {
              resultData.data[i] = imageData.data[i];
              resultData.data[i + 1] = imageData.data[i + 1];
              resultData.data[i + 2] = imageData.data[i + 2];
              resultData.data[i + 3] = imageData.data[i + 3];
            }
          } else if (showRedBackground) {
            const isCloseToRedOrange = selectedColorObjects.some(selectedColor => {
              const isRedOrangeSelected = selectedColor.r > selectedColor.g && selectedColor.r > selectedColor.b;
              return isRedOrangeSelected && minDistance < tolerance * 1.5;
            });
            
            if (isCloseToRedOrange) {
              resultData.data[i] = 0;
              resultData.data[i + 1] = 0;
              resultData.data[i + 2] = 0;
              resultData.data[i + 3] = 255;
            } else {
              resultData.data[i] = 255;
              resultData.data[i + 1] = 0;
              resultData.data[i + 2] = 0;
              resultData.data[i + 3] = 255;
            }
          } else {
            resultData.data[i] = 0;
            resultData.data[i + 1] = 0;
            resultData.data[i + 2] = 0;
            resultData.data[i + 3] = 0;
          }
        }
      }

      resultCtx.putImageData(resultData, 0, 0);
      setIsProcessing(false);
    }, 100);
  }, [croppedImage, originalImage, selectedColors, tolerance, showRedBackground, desaturateResult]);

  const downloadResult = () => {
    const canvas = resultCanvasRef.current;
    if (!canvas) return;

    console.log('Processing download with circular crop...');
    
    console.log('Download circular mask processing:', {
      maskActive: !!activeCircularMask,
      selectedColors: selectedColors.size,
      willFilterOutput: !!activeCircularMask && selectedColors.size > 0,
      maskDetails: activeCircularMask ? `center(${Math.round(activeCircularMask.centerX)}, ${Math.round(activeCircularMask.centerY)}) radius ${Math.round(activeCircularMask.radius)}` : 'none'
    });

    const originalCanvas = originalCanvasRef.current;
    if (!originalCanvas) return;

    const originalCtx = originalCanvas.getContext('2d');
    if (!originalCtx) return;

    // If we have a circular mask, create a square canvas containing just the circle
    if (activeCircularMask) {
      const { centerX, centerY, radius } = activeCircularMask;
      
      // Calculate the square bounds that contain the circle
      const cropX = Math.max(0, Math.floor(centerX - radius));
      const cropY = Math.max(0, Math.floor(centerY - radius));
      const cropSize = Math.ceil(radius * 2);
      
      // Create output canvas sized to the circle diameter
      const circularCanvas = document.createElement('canvas');
      const circularCtx = circularCanvas.getContext('2d');
      if (!circularCtx) return;

      circularCanvas.width = cropSize;
      circularCanvas.height = cropSize;

      // Get the original image data (without any overlays) from the source image
      const originalImageToUse = croppedImage || originalImage;
      if (!originalImageToUse) return;

      // Create a clean canvas with just the original image data
      const cleanCanvas = document.createElement('canvas');
      const cleanCtx = cleanCanvas.getContext('2d');
      if (!cleanCtx) return;

      cleanCanvas.width = originalCanvas.width;
      cleanCanvas.height = originalCanvas.height;
      cleanCtx.drawImage(originalImageToUse, 0, 0, cleanCanvas.width, cleanCanvas.height);
      
      const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
      const resultData = circularCtx.createImageData(cropSize, cropSize);

      // Convert selected colors to ColorInfo objects
      const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
        const [r, g, b] = colorStr.split(',').map(Number);
        return { r, g, b, a: 255 };
      });

      // Calculate the circle center relative to the cropped area
      const relativeCenterX = centerX - cropX;
      const relativeCenterY = centerY - cropY;

      // Process each pixel in the cropped circular area
      for (let y = 0; y < cropSize; y++) {
        for (let x = 0; x < cropSize; x++) {
          const resultIndex = (y * cropSize + x) * 4;
          
          // Calculate distance from circle center
          const dx = x - relativeCenterX;
          const dy = y - relativeCenterY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Check if pixel is within the circle
          if (distance <= radius) {
            // Get the original image coordinates
            const originalX = cropX + x;
            const originalY = cropY + y;
            
            // Make sure we're within the original image bounds
            if (originalX >= 0 && originalX < originalCanvas.width && 
                originalY >= 0 && originalY < originalCanvas.height) {
              
              const originalIndex = (originalY * originalCanvas.width + originalX) * 4;
              
              const pixelColor = {
                r: imageData.data[originalIndex],
                g: imageData.data[originalIndex + 1],
                b: imageData.data[originalIndex + 2],
                a: imageData.data[originalIndex + 3]
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
                // Keep the original color with full opacity (or desaturated if enabled)
                if (desaturateResult) {
                  const desaturated = desaturateColor(
                    imageData.data[originalIndex],
                    imageData.data[originalIndex + 1],
                    imageData.data[originalIndex + 2]
                  );
                  resultData.data[resultIndex] = desaturated.r;
                  resultData.data[resultIndex + 1] = desaturated.g;
                  resultData.data[resultIndex + 2] = desaturated.b;
                  resultData.data[resultIndex + 3] = 255; // Full opacity
                } else {
                  resultData.data[resultIndex] = imageData.data[originalIndex];     // R
                  resultData.data[resultIndex + 1] = imageData.data[originalIndex + 1]; // G
                  resultData.data[resultIndex + 2] = imageData.data[originalIndex + 2]; // B
                  resultData.data[resultIndex + 3] = 255; // Full opacity
                }
              } else {
                // Make transparent for unselected colors
                resultData.data[resultIndex] = 0;     // R
                resultData.data[resultIndex + 1] = 0; // G
                resultData.data[resultIndex + 2] = 0; // B
                resultData.data[resultIndex + 3] = 0; // A (transparent)
              }
            } else {
              // Outside original image bounds - make transparent
              resultData.data[resultIndex] = 0;
              resultData.data[resultIndex + 1] = 0;
              resultData.data[resultIndex + 2] = 0;
              resultData.data[resultIndex + 3] = 0;
            }
          } else {
            // Outside circle - make transparent
            resultData.data[resultIndex] = 0;
            resultData.data[resultIndex + 1] = 0;
            resultData.data[resultIndex + 2] = 0;
            resultData.data[resultIndex + 3] = 0;
          }
        }
      }

      circularCtx.putImageData(resultData, 0, 0);

      console.log('Circular crop details:', {
        originalSize: `${originalCanvas.width}x${originalCanvas.height}`,
        circleCenter: `(${Math.round(centerX)}, ${Math.round(centerY)})`,
        radius: Math.round(radius),
        outputSize: `${cropSize}x${cropSize}`,
        cropPosition: `(${cropX}, ${cropY})`
      });

      circularCanvas.toBlob((blob) => {
        if (!blob) return;
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `color-selection-circle-${cropSize}x${cropSize}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('Downloaded circular crop PNG:', {
          resolution: `${cropSize}x${cropSize}`,
          fileSize: `${(blob.size / 1024 / 1024).toFixed(2)} MB`
        });
      }, 'image/png');
      
      return;
    }

    // Fallback to regular auto-crop for non-circular selections
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;

    const imageData = originalCtx.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    const resultData = tempCtx.createImageData(imageData.width, imageData.height);

    const selectedColorObjects = Array.from(selectedColors).map(colorStr => {
      const [r, g, b] = colorStr.split(',').map(Number);
      return { r, g, b, a: 255 };
    });

    for (let y = 0; y < imageData.height; y++) {
      for (let x = 0; x < imageData.width; x++) {
        const i = (y * imageData.width + x) * 4;
        
        const pixelColor = {
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        };

        let isSelected = false;
        for (const selectedColor of selectedColorObjects) {
          if (colorDistance(pixelColor, selectedColor) <= tolerance) {
            isSelected = true;
            break;
          }
        }

        if (isSelected) {
          if (desaturateResult) {
            const desaturated = desaturateColor(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]);
            resultData.data[i] = desaturated.r;
            resultData.data[i + 1] = desaturated.g;
            resultData.data[i + 2] = desaturated.b;
            resultData.data[i + 3] = imageData.data[i + 3];
          } else {
            resultData.data[i] = imageData.data[i];
            resultData.data[i + 1] = imageData.data[i + 1];
            resultData.data[i + 2] = imageData.data[i + 2];
            resultData.data[i + 3] = imageData.data[i + 3];
          }
        } else {
          resultData.data[i] = 0;
          resultData.data[i + 1] = 0;
          resultData.data[i + 2] = 0;
          resultData.data[i + 3] = 0;
        }
      }
    }

    tempCtx.putImageData(resultData, 0, 0);

    // Auto-crop to content bounds
    let minX = tempCanvas.width, minY = tempCanvas.height, maxX = 0, maxY = 0, hasContent = false;

    for (let y = 0; y < tempCanvas.height; y++) {
      for (let x = 0; x < tempCanvas.width; x++) {
        const index = (y * tempCanvas.width + x) * 4;
        if (resultData.data[index + 3] > 0) {
          hasContent = true;
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }

    if (!hasContent) return;

    const padding = 2;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropWidth = Math.min(tempCanvas.width - cropX, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(tempCanvas.height - cropY, maxY - minY + 1 + padding * 2);

    const croppedCanvas = document.createElement('canvas');
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) return;

    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    croppedCtx.putImageData(tempCtx.getImageData(cropX, cropY, cropWidth, cropHeight), 0, 0);

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
      
      // Immediately process with the current circular mask
      setTimeout(() => {
        if (newSelected.size > 0) {
          processImage(activeCircularMask || undefined);
        }
      }, 0);
      
      return newSelected;
    });
  };

  const selectAllColors = () => {
    const allColors = new Set(detectedColors.map(c => c.color));
    setSelectedColors(allColors);
    
    // Immediately process with the current circular mask
    if (allColors.size > 0) {
      setTimeout(() => processImage(activeCircularMask || undefined), 0);
    }
  };

  const deselectAllColors = () => {
    setSelectedColors(new Set());
  };

  // Auto-process when selection or tolerance changes
  useEffect(() => {
    if (selectedColors.size > 0) {
      processImage(activeCircularMask || undefined);
    }
  }, [selectedColors, tolerance, processImage, activeCircularMask]);

  // Debounced effect for circular mask analysis
  useEffect(() => {
    if (activeCircularMask && originalImage) {
      const timeoutId = setTimeout(() => {
        const imageToUse = croppedImage || originalImage;
        analyzeImageColors(imageToUse, activeCircularMask);
        
        // Also trigger processing if colors are already selected
        if (selectedColors.size > 0) {
          processImage(activeCircularMask);
        }
      }, 300); // 300ms delay to prevent too frequent analysis
      
      return () => clearTimeout(timeoutId);
    }
  }, [activeCircularMask, originalImage, croppedImage, selectedColors.size, processImage]);

  // Redraw image when canvas ref becomes available
  useEffect(() => {
    if (originalImage && originalCanvasRef.current) {
      const imageToUse = croppedImage || originalImage;
      drawOriginalImage(imageToUse);
      // Only analyze colors if we don't have any detected colors yet, or if we have a new image
      if (!detectedColors.length || !croppedImage) {
        analyzeImageColors(imageToUse, activeCircularMask || undefined);
      }
    }
  }, [originalImage, croppedImage]);

  // Draw crop overlay when crop area changes
  useEffect(() => {
    if (isCropMode && cropArea) {
      drawCropOverlay();
    }
  }, [cropArea, isCropMode]);

  // Handle keyboard events for moving and resizing crop area
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only handle keys when in crop mode and we have a crop area
      if (!isCropMode || !cropArea) return;
      
      const canvas = originalCanvasRef.current;
      if (!canvas) return;
      
      // Prevent default behavior for handled keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'BracketLeft', 'BracketRight'].includes(event.code)) {
        event.preventDefault();
        
        const moveDistance = event.shiftKey ? 5 : 1; // Hold Shift for faster movement/resizing
        
        // Movement with arrow keys (when not holding Ctrl)
        if (!event.ctrlKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
          let newX = cropArea.x;
          let newY = cropArea.y;
          
          switch (event.code) {
            case 'ArrowUp':
              newY = Math.max(0, cropArea.y - moveDistance);
              break;
            case 'ArrowDown':
              newY = Math.min(canvas.height - cropArea.height, cropArea.y + moveDistance);
              break;
            case 'ArrowLeft':
              newX = Math.max(0, cropArea.x - moveDistance);
              break;
            case 'ArrowRight':
              newX = Math.min(canvas.width - cropArea.width, cropArea.x + moveDistance);
              break;
          }
          
          setCropArea({
            ...cropArea,
            x: newX,
            y: newY
          });
        }
        
        // Resizing with Ctrl + arrow keys, or +/- keys, or [ ] keys
        if ((event.ctrlKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) ||
            ['Equal', 'Minus', 'BracketLeft', 'BracketRight'].includes(event.code)) {
          
          const resizeAmount = event.shiftKey ? 10 : 2; // Bigger steps with Shift
          let newWidth = cropArea.width;
          let newHeight = cropArea.height;
          let newX = cropArea.x;
          let newY = cropArea.y;
          
          if (cropMode === 'circle') {
            // For circles, resize uniformly
            const isExpand = event.code === 'ArrowDown' || event.code === 'ArrowRight' || 
                             event.code === 'Equal' || event.code === 'BracketRight';
            const change = isExpand ? resizeAmount * 2 : -resizeAmount * 2; // Diameter change
            
            newWidth = Math.max(20, Math.min(canvas.width, cropArea.width + change));
            newHeight = newWidth; // Keep it circular
            
            // Adjust position to keep circle centered
            const widthDiff = newWidth - cropArea.width;
            newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
            newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
            
          } else {
            // For rectangles, resize based on specific direction or uniform
            if (event.code === 'Equal' || event.code === 'BracketRight') {
              // Expand uniformly
              newWidth = Math.max(20, Math.min(canvas.width, cropArea.width + resizeAmount * 2));
              newHeight = Math.max(20, Math.min(canvas.height, cropArea.height + resizeAmount * 2));
              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - resizeAmount));
              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - resizeAmount));
            } else if (event.code === 'Minus' || event.code === 'BracketLeft') {
              // Contract uniformly
              newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
              newHeight = Math.max(20, cropArea.height - resizeAmount * 2);
              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x + resizeAmount));
              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y + resizeAmount));
            } else {
              // Directional resizing with Ctrl + arrows
              switch (event.code) {
                case 'ArrowUp':
                  newHeight = Math.max(20, cropArea.height - resizeAmount);
                  newY = Math.min(canvas.height - newHeight, cropArea.y + resizeAmount);
                  break;
                case 'ArrowDown':
                  newHeight = Math.max(20, Math.min(canvas.height - cropArea.y, cropArea.height + resizeAmount));
                  break;
                case 'ArrowLeft':
                  newWidth = Math.max(20, cropArea.width - resizeAmount);
                  newX = Math.min(canvas.width - newWidth, cropArea.x + resizeAmount);
                  break;
                case 'ArrowRight':
                  newWidth = Math.max(20, Math.min(canvas.width - cropArea.x, cropArea.width + resizeAmount));
                  break;
              }
            }
          }
          
          setCropArea({
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
          });
        }
      }
    };
    
    // Add event listener when in crop mode
    if (isCropMode && cropArea) {
      window.addEventListener('keydown', handleKeyPress);
      return () => {
        window.removeEventListener('keydown', handleKeyPress);
      };
    }
  }, [isCropMode, cropMode, cropArea]);

  // Detect circles when switching to circle mode on an already cropped image - REMOVED
  // Using manual circle positioning instead

  return (
    <div className={`w-full max-w-6xl mx-auto p-4 space-y-6 ${className || ''} ${isDarkMode ? 'dark' : ''}`}>
      <Card className={isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white'}>
        <CardHeader className={isDarkMode ? 'text-white' : ''}>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Color Range Selection Tool
            </CardTitle>
            <Button
              onClick={() => setIsDarkMode(!isDarkMode)}
              variant="outline"
              size="sm"
              className={`flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 border-gray-600 text-white hover:bg-gray-700' : ''}`}
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {isDarkMode ? 'Light' : 'Dark'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={`space-y-6 ${isDarkMode ? 'text-white' : ''}`}>
          {/* 1. Upload Image */}
          <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span>
              Upload Image
            </h3>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Choose Image
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
            </div>
          </div>

          {/* 2. Crop Area (if image is loaded) */}
          {originalImage && (
            <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span>
                Crop Area (Optional)
              </h3>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    onClick={() => setIsCropMode(!isCropMode)}
                    variant={isCropMode ? "default" : "outline"}
                    size="sm"
                    className={`flex items-center gap-1 ${isDarkMode && !isCropMode ? 'border-gray-600 text-white hover:bg-gray-700' : ''}`}
                  >
                    <Crop className="w-3 h-3" />
                    {isCropMode ? 'Exit Crop Mode' : 'Enable Crop Mode'}
                  </Button>
                  
                  {isCropMode && (
                    <>
                      <div className="flex gap-1 border rounded-md p-1">
                        <Button
                          onClick={() => setCropMode('rectangle')}
                          variant={cropMode === 'rectangle' ? "default" : "ghost"}
                          size="sm"
                          className="h-6 px-2 text-xs"
                        >
                          □ Rectangle
                        </Button>
                        <Button
                          onClick={() => {
                            setCropMode('circle');
                            setCropArea(null);
                          }}
                          variant={cropMode === 'circle' ? "default" : "ghost"}
                          size="sm"
                          className="h-6 px-2 text-xs"
                        >
                          <Circle className="w-3 h-3 mr-1" />
                          Circle
                        </Button>
                      </div>
                    </>
                  )}
                  
                  {croppedImage && (
                    <Button
                      onClick={() => {
                        setCroppedImage(null);
                        setIsCropMode(false);
                        setCropArea(null);
                        setActiveCircularMask(null);
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
                
                {cropArea && (
                  <div className="mt-3">
                    <div className="flex items-center gap-2 text-xs mb-2">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>
                        Keyboard Controls:
                      </span>
                      <kbd className={`px-1 py-0.5 rounded border ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-100 border-gray-300'}`}>
                        ↑↓←→
                      </kbd>
                      <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Move</span>
                      <kbd className={`px-1 py-0.5 rounded border ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-100 border-gray-300'}`}>
                        +/-
                      </kbd>
                      <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Resize</span>
                      {cropMode === 'rectangle' && (
                        <>
                          <kbd className={`px-1 py-0.5 rounded border ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-100 border-gray-300'}`}>
                            Ctrl+↑↓←→
                          </kbd>
                          <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Directional</span>
                        </>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-2 items-center">
                      <Button
                        onClick={applyCrop}
                        size="sm"
                        className="flex items-center gap-1"
                      >
                        <ZoomIn className="w-3 h-3" />
                        Apply Crop
                      </Button>
                      
                      <div className="flex items-center gap-1 border rounded-md p-1">
                        <Button
                          onClick={() => {
                            if (!cropArea) return;
                            const canvas = originalCanvasRef.current;
                            if (!canvas) return;
                            
                            const resizeAmount = 10;
                            let newWidth, newHeight, newX, newY;
                            
                            if (cropMode === 'circle') {
                              newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
                              newHeight = newWidth;
                              const widthDiff = newWidth - cropArea.width;
                              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
                              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
                            } else {
                              newWidth = Math.max(20, cropArea.width - resizeAmount * 2);
                              newHeight = Math.max(20, cropArea.height - resizeAmount * 2);
                              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x + resizeAmount));
                              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y + resizeAmount));
                            }
                            
                            setCropArea({ x: newX, y: newY, width: newWidth, height: newHeight });
                          }}
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          title="Make smaller"
                        >
                          −
                        </Button>
                        <Button
                          onClick={() => {
                            if (!cropArea) return;
                            const canvas = originalCanvasRef.current;
                            if (!canvas) return;
                            
                            const resizeAmount = 10;
                            let newWidth, newHeight, newX, newY;
                            
                            if (cropMode === 'circle') {
                              newWidth = Math.min(canvas.width, cropArea.width + resizeAmount * 2);
                              newHeight = newWidth;
                              const widthDiff = newWidth - cropArea.width;
                              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - widthDiff / 2));
                              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - widthDiff / 2));
                            } else {
                              newWidth = Math.min(canvas.width, cropArea.width + resizeAmount * 2);
                              newHeight = Math.min(canvas.height, cropArea.height + resizeAmount * 2);
                              newX = Math.max(0, Math.min(canvas.width - newWidth, cropArea.x - resizeAmount));
                              newY = Math.max(0, Math.min(canvas.height - newHeight, cropArea.y - resizeAmount));
                            }
                            
                            setCropArea({ x: newX, y: newY, width: newWidth, height: newHeight });
                          }}
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          title="Make larger"
                        >
                          +
                        </Button>
                      </div>
                      
                      {activeCircularMask && cropMode === 'circle' && (
                        <Button
                          onClick={() => {
                            setActiveCircularMask(null);
                            if (originalImage) {
                              const imageToUse = croppedImage || originalImage;
                              analyzeImageColors(imageToUse);
                            }
                          }}
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-xs"
                          title="Analyze full image colors"
                        >
                          Clear Circle Filter
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                
                {isCropMode && (
                  <div className={`mt-3 p-3 rounded ${isDarkMode ? 'bg-blue-900 text-blue-100' : 'bg-blue-50 text-blue-800'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Crop className="w-4 h-4" />
                      <span className="font-medium">Crop Mode: {cropMode === 'rectangle' ? 'Rectangle' : 'Circle'}</span>
                    </div>
                    <p className="text-sm">
                      {cropMode === 'rectangle' 
                        ? `Click and drag to select a rectangular area to crop.`
                        : `Click and drag to select a circular area. Colors will be analyzed only within the circle.`
                      }
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Select Colors */}
          {originalImage && (
            <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">3</span>
                Select Colors
              </h3>
              
              <div className="space-y-4">
                {/* Tolerance Control */}
                <div className="flex items-center gap-4">
                  <label htmlFor="tolerance" className="text-sm font-medium">
                    Color Tolerance:
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

                {/* Current Selection Info */}
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
                      Reset Selection
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Color Swatches */}
          {detectedColors.length > 0 && (
            <div className="space-y-4 mt-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-md font-medium">Available Colors ({detectedColors.length})</h4>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <select 
                      onChange={(e) => {
                        const [filterType, action] = e.target.value.split('-') as ['dark' | 'light' | 'colorful' | 'all', 'select' | 'deselect'];
                        if (filterType && action) {
                          selectColorsByFilter(filterType, action);
                        }
                        e.target.value = '';
                      }}
                      className={`text-xs px-2 py-1 border rounded cursor-pointer ${
                        isDarkMode 
                          ? 'bg-gray-800 border-gray-600 text-white' 
                          : 'bg-white border-gray-300'
                      }`}
                      defaultValue=""
                    >
                      <option value="" disabled>Quick Filters</option>
                      <option value="dark-select">Select Dark Shades</option>
                      <option value="dark-deselect">Deselect Dark Shades</option>
                      <option value="light-select">Select Light Shades</option>
                      <option value="light-deselect">Deselect Light Shades</option>
                      <option value="colorful-select">Select Colorful</option>
                      <option value="colorful-deselect">Deselect Colorful</option>
                    </select>
                  </div>
                  <Button
                    onClick={selectAllColors}
                    variant="outline"
                    size="sm"
                    className={`text-xs ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-700' : ''}`}
                  >
                    Select All
                  </Button>
                  <Button
                    onClick={deselectAllColors}
                    variant="outline"
                    size="sm"
                    className={`text-xs ${isDarkMode ? 'border-gray-600 text-white hover:bg-gray-700' : ''}`}
                  >
                    Clear All
                  </Button>
                </div>
              </div>
              
              <p className="text-sm text-gray-600">
                Click on color swatches to select/deselect them for the output
              </p>
              
              <div className={`flex flex-wrap gap-4 text-xs p-2 rounded ${
                isDarkMode 
                  ? 'bg-gray-800 text-gray-300' 
                  : 'bg-gray-50 text-gray-500'
              }`}>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-black rounded-full border border-white"></div>
                  <span>Dark</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-white rounded-full border border-gray-400"></div>
                  <span>Light</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-gradient-to-r from-red-400 to-blue-400 rounded-full border border-white"></div>
                  <span>Colorful</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-orange-400 rounded-full border border-white"></div>
                  <span>Red/Orange</span>
                </div>
              </div>
              
              {isAnalyzing ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-sm text-gray-500">Analyzing colors...</div>
                </div>
              ) : (
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 lg:grid-cols-16 gap-2">
                  {detectedColors.map((colorData, index) => {
                    const isSelected = selectedColors.has(colorData.color);
                    const [r, g, b] = colorData.color.split(',').map(Number);
                    
                    const isWarmColor = r > g && r > b;
                    const isRed = r > 150 && g < 100 && b < 100;
                    const isOrange = r > 150 && g > 50 && g < 200 && b < 150;
                    const { isDark, isLight, isColorful } = classifyColor(r, g, b);
                    
                    const colorType = isRed ? ' (Red)' : isOrange ? ' (Orange)' : isWarmColor ? ' (Warm)' : '';
                    const brightnessType = isDark ? ' • Dark' : isLight ? ' • Light' : ' • Medium';
                    const saturationText = isColorful ? ' • Colorful' : ' • Grayscale';
                    
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
                          ${isRed || isOrange ? 'ring-1 ring-orange-300' : ''}
                        `}
                        style={{ 
                          backgroundColor: `rgb(${r}, ${g}, ${b})`,
                        }}
                        title={`RGB(${r}, ${g}, ${b})${colorType}${brightnessType}${saturationText} - ${colorData.count} pixels`}
                      >
                        {isSelected && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-3 h-3 bg-white rounded-full border border-gray-300 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                            </div>
                          </div>
                        )}
                        
                        <div className="absolute top-0 left-0 flex flex-col">
                          {isDark && (
                            <div className="w-2 h-2 bg-black rounded-full border border-white m-0.5" title="Dark shade"></div>
                          )}
                          {isLight && (
                            <div className="w-2 h-2 bg-white rounded-full border border-gray-400 m-0.5" title="Light shade"></div>
                          )}
                        </div>
                        
                        <div className="absolute top-0 right-0 flex flex-col">
                          {isColorful && (
                            <div className="w-2 h-2 bg-gradient-to-r from-red-400 to-blue-400 rounded-full border border-white m-0.5" title="Colorful"></div>
                          )}
                          {(isRed || isOrange) && (
                            <div className="w-2 h-2 bg-orange-400 rounded-full border border-white m-0.5" title="Red/Orange"></div>
                          )}
                        </div>
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

          {/* 4. Output Options */}
          {selectedColors.size > 0 && (
            <div className={`border rounded-lg p-4 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-sm">4</span>
                Output Options
              </h3>
              
              <div className="space-y-3">
                {/* Preview Options */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showRedBackground}
                      onChange={(e) => setShowRedBackground(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <Eye className="w-4 h-4" />
                    Show red contrast background (preview only)
                  </label>
                </div>

                {/* Desaturate Option */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={desaturateResult}
                      onChange={(e) => setDesaturateResult(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <Palette className="w-4 h-4" />
                    Convert to grayscale
                  </label>
                  <span className="text-xs text-gray-500">
                    (Removes color from the result)
                  </span>
                </div>

                {/* Download Button */}
                <Button
                  onClick={downloadResult}
                  disabled={isProcessing}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download PNG Result
                </Button>
              </div>
            </div>
          )}

          {/* Image Display */}
          {originalImage ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Source Image */}
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {croppedImage ? 'Cropped Area' : 'Source Image'}
                </h3>
                <p className="text-sm text-gray-600">
                  {isCropMode 
                    ? `Draw a ${cropMode} to select crop area` 
                    : 'Click on colors to select them'
                  }
                </p>
                <div className={`border-2 rounded-lg p-4 min-h-[300px] flex items-center justify-center ${
                  isDarkMode 
                    ? 'border-gray-600 bg-gray-800' 
                    : 'border-gray-300 bg-white'
                }`}>
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
                      imageRendering: 'auto'
                    }}
                  />
                </div>
              </div>

              {/* Result Preview */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Result Preview</h3>
                    <p className="text-sm text-gray-600">Selected colors with transparent background</p>
                  </div>
                </div>
                <div className={`border-2 rounded-lg p-4 min-h-[300px] flex items-center justify-center ${
                  isDarkMode 
                    ? 'border-gray-600' 
                    : 'border-gray-300'
                } ${
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
                          imageRendering: 'auto'
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
                      <p className="text-sm">Select colors to see the preview</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <Upload className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">Get Started</h3>
              <p className="mb-1">Upload an image to begin selecting colors</p>
              <p className="text-sm">The tool will analyze the image and let you select specific colors for extraction</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ColorRangeSelector;
