import type { Area } from "react-easy-crop";

export const TARGET_CROP_ASPECT = 3 / 4;
const ASPECT_TOLERANCE = 0.015;
const DEFAULT_OUTPUT_MIME = "image/jpeg";

function createImageElement(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem para recorte."));
    image.src = sourceUrl;
  });
}

export function isThreeByFour(width: number, height: number) {
  return Math.abs(width / height - TARGET_CROP_ASPECT) <= ASPECT_TOLERANCE;
}

export async function loadImageDimensions(file: File) {
  const previewUrl = URL.createObjectURL(file);

  try {
    const image = await createImageElement(previewUrl);

    return {
      previewUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

export async function cropImageFile(sourceUrl: string, cropArea: Area, sourceFile: File) {
  const image = await createImageElement(sourceUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropArea.width);
  canvas.height = Math.round(cropArea.height);

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel preparar o recorte da imagem.");
  }

  context.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const outputMime = sourceFile.type.startsWith("image/") ? sourceFile.type : DEFAULT_OUTPUT_MIME;
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, outputMime, 0.92);
  });

  if (!blob) {
    throw new Error("Nao foi possivel gerar o arquivo recortado.");
  }

  return new File([blob], sourceFile.name, {
    type: blob.type || outputMime,
    lastModified: Date.now(),
  });
}
