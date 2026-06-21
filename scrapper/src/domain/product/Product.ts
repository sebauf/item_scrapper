export interface Price {
  amount: number;
  currency: string;
}

export interface UnitPrice {
  amount: number;
  unit: string;
}

export interface Product {
  url: string;
  title: string;
  price: Price | null;
  crossedOutPrice: Price | null;
  unitPrice: UnitPrice | null;
  deliveryDate: string | null;
  images: string[];
  shop: string;
  keyword: string | null;
  scrapedAt: Date;
}
