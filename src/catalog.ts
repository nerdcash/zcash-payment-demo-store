import { formatZecDisplay } from "./money.js";

export type Product = {
  id: string;
  name: string;
  blurb: string;
  description: string;
  priceZat: number;
  image: string;
};

export const products: readonly Product[] = [
  {
    id: "espresso-cup",
    name: "Stoneware Espresso Cup",
    blurb: "Thick-walled stoneware, glazed the color of river stone.",
    description:
      "A single cup with a heavy base and a quiet grey glaze. It holds one espresso and stays warm a little longer than you expect.",
    priceZat: 8_000_000,
    image: "/products/espresso-cup.jpg",
  },
  {
    id: "linen-tote",
    name: "Linen Market Tote",
    blurb: "Undyed linen, a flat bottom, handles you can actually carry.",
    description:
      "Washed linen with cotton webbing handles. It stands up on its own and softens every time you use it.",
    priceZat: 15_000_000,
    image: "/products/linen-tote.jpg",
  },
  {
    id: "cedar-holder",
    name: "Cedar Incense Holder",
    blurb: "A small block of cedar with a groove for ash.",
    description:
      "Solid cedar, left unfinished. One groove holds the stick. The other catches the ash. The wood darkens slowly.",
    priceZat: 5_000_000,
    image: "/products/cedar-holder.jpg",
  },
  {
    id: "wool-throw",
    name: "Wool Throw, Oat",
    blurb: "Herringbone wool in the color of dry grass.",
    description:
      "A light wool throw, folded small enough for the end of a bed. The weave is herringbone, the color closer to oat than to cream.",
    priceZat: 42_000_000,
    image: "/products/wool-throw.jpg",
  },
  {
    id: "brass-lamp",
    name: "Brass Task Lamp",
    blurb: "Unlacquered brass that will darken where you touch it.",
    description:
      "A small task lamp in bare brass. The shade tilts. The metal is meant to mark, so the lamp looks more like yours after a year.",
    priceZat: 68_000_000,
    image: "/products/brass-lamp.jpg",
  },
  {
    id: "cloth-notebook",
    name: "Clothbound Notebook",
    blurb: "Plain cotton cover, stitched binding, no logo on the front.",
    description:
      "A blank notebook with a cotton cover and an exposed stitch. No lines, no foil, nothing printed on the front.",
    priceZat: 4_000_000,
    image: "/products/cloth-notebook.jpg",
  },
];

export function getProduct(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}

export function priceLabel(priceZat: number): string {
  return formatZecDisplay(priceZat);
}

export function catalogClientData(): Array<{
  id: string;
  name: string;
  priceZat: number;
  price: string;
  image: string;
}> {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    priceZat: product.priceZat,
    price: priceLabel(product.priceZat),
    image: product.image,
  }));
}
