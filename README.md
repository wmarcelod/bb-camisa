# BB Camisa

Aplicativo web para subir uma ou varias fotos de pessoas e gerar uma nova imagem usando a API da OpenAI com um prompt fixo e a imagem-base da camisa.

## Stack

- Next.js
- TypeScript
- OpenAI Images API (`/v1/images/edits`)
- Docker para deploy no Dokploy

## Variaveis de ambiente

Crie as variaveis abaixo:

```bash
OPENAI_API_KEY=seu_token
OPENAI_IMAGE_MODEL=gpt-image-1.5
```

`OPENAI_IMAGE_MODEL` e opcional. O padrao atual do projeto usa `gpt-image-1.5`.

## Desenvolvimento local

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Prompt fixo

O prompt de geracao fica travado no backend em `src/lib/prompt.ts` para impedir alteracao pelo navegador.

## Imagem-base da camisa

A imagem-base utilizada pela API esta em `public/base-shirt.jpeg`.

## Deploy

O projeto foi preparado para deploy em Docker no Dokploy usando a porta `3000`.
