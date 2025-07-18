import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ImageUploaderProps {
  onImageChange?: (imageSrc: string) => void;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onImageChange }) => {
  const [urlInput, setUrlInput] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [lastImageSrc, setLastImageSrc] = useState<string>('');
  const pasteAreaRef = useRef<HTMLDivElement>(null);

  // Handle URL input
  const handleUrlUpload = () => {
    if (urlInput.trim()) {
      setLastImageSrc(urlInput.trim());
      onImageChange?.(urlInput.trim());
    }
  };

  // Handle paste event
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const result = event.target?.result as string;
            setLastImageSrc(result);
            onImageChange?.(result);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setLastImageSrc(result);
        onImageChange?.(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const clearImage = () => {
    setLastImageSrc('');
    setUrlInput('');
    onImageChange?.('');
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* URL Input Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Image from URL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter image URL (e.g., https://example.com/image.jpg)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
              onKeyPress={(e) => e.key === 'Enter' && handleUrlUpload()}
            />
            <Button onClick={handleUrlUpload} disabled={!urlInput.trim()}>
              Load Image
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Paste/Drop Area */}
      <Card>
        <CardHeader>
          <CardTitle>Paste or Drop Image</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={pasteAreaRef}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            tabIndex={0}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${isDragOver 
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
              }
              focus:outline-none focus:ring-2 focus:ring-blue-500
            `}
          >
            <div className="space-y-2">
              <div className="text-lg font-medium">
                📋 Click here and paste an image (Ctrl+V)
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Or drag and drop an image file here
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Message */}
      {lastImageSrc && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm text-green-600 dark:text-green-400">
                ✓ Image loaded successfully! Check the preview below.
              </div>
              <Button variant="outline" size="sm" onClick={clearImage}>
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ImageUploader;
