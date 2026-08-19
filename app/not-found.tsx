import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-muted-foreground text-5xl font-bold">404</p>
      <h1 className="mt-3 text-xl font-semibold">Sahifa topilmadi</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Havola eskirgan yoki sahifa o&apos;chirilgan bo&apos;lishi mumkin.
      </p>
      <Link
        href="/uz"
        className="bg-primary text-primary-foreground mt-6 h-10 rounded-full px-5 text-sm leading-10 font-medium"
      >
        Bosh sahifaga
      </Link>
    </div>
  );
}
