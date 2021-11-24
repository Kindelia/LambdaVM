// Importing a dylib on TypeScript

import * as Lambolt from "https://raw.githubusercontent.com/Kindelia/LamBolt/master/src/LamBolt.ts"
import * as Crusher from "./Crusher/Language.ts"
import * as Compile from "./Compile/Compile.ts"
import * as Convert from "./Compile/Convert.ts"

function dylib_suffix() {
  switch (Deno.build.os) {
    case "windows": return "dll";
    case "darwin": return "dylib";
    case "linux": return "so";
  }
}

async function build_runtime(file: Lambolt.File, target: string) {
  var comp = Compile.compile(file, target);
  var srcp = new URL("./Crusher/Runtime."+target, import.meta.url);
  var trgp = new URL("./../bin/Runtime."+target, import.meta.url);
  var code = (await Deno.readTextFile(srcp)).replace("//GENERATED_CODE//", comp);
  await Deno.writeTextFileSync(trgp, code);
}

async function compile_c_dylib() {
  var bin = (new URL("./../bin/", import.meta.url)).pathname;
  var st0 = await Deno.run({cmd: ["clang", "-O3", "-c", "-o", bin+"Runtime.o", bin+"Runtime.c"]}).status();
  var st1 = await Deno.run({cmd: ["clang", "-O3", "-shared", "-o", bin+"Runtime."+dylib_suffix(), bin+"Runtime.c"]}).status();
}

function load_c_dylib() {
  var path = new URL("./../bin/Runtime." + dylib_suffix(), import.meta.url);
  return Deno.dlopen(path, {
    "normal_ffi": {
      parameters: [
        "buffer","u32", "buffer","u32", "buffer","u32", "buffer","u32",
        "buffer","u32", "buffer","u32", "buffer","u32", "buffer","u32",
        "buffer","u32", "buffer","u32", "u32"
      ],
      result: "u32",
    },
    "get_gas": {
      parameters: [],
      result: "u32"
    },
  });
}

function normal_clang(MEM: Crusher.Mem, host: Crusher.Loc): number {
  var dylib = load_c_dylib();

  function convert(arr: Uint32Array): Uint8Array {
    return new Uint8Array(arr.buffer);
  }

  MEM.lnk.size = dylib.symbols.normal_ffi(
    convert(MEM.lnk.data), MEM.lnk.size,
    convert(MEM.use[0].data), MEM.use[0].size,
    convert(MEM.use[1].data), MEM.use[2].size,
    convert(MEM.use[2].data), MEM.use[2].size,
    convert(MEM.use[3].data), MEM.use[3].size,
    convert(MEM.use[4].data), MEM.use[4].size,
    convert(MEM.use[5].data), MEM.use[5].size,
    convert(MEM.use[6].data), MEM.use[6].size,
    convert(MEM.use[7].data), MEM.use[7].size,
    convert(MEM.use[8].data), MEM.use[8].size,
    host
  ) as number;

  return dylib.symbols.get_gas() as number;
}

export async function run(code: string, opts: any) {

  // Reads file as Lambolt Defs
  // --------------------------
  
  var file = Lambolt.read(Lambolt.parse_file, code);
  //console.log(Lambolt.show_file(file));
  var main = file.defs[file.defs.length - 1];
  if (!(main && main.$ === "NewBond" && main.bond.name === "main" && main.bond.body.$ === "Body")) {
    throw "Main not found.";
  }
  var name_table = Compile.gen_name_table(file);
  var numb_table : {[numb:string]:string} = {};
  for (var name in name_table) {
    numb_table[String(name_table[name])] = name;
  }

  // Builds normalizer function
  // --------------------------

  var normal : ((MEM: Crusher.Mem, host: Crusher.Loc) => number) | null = null;

  if (opts.target === "c") {
    await build_runtime(file, "c");
    await compile_c_dylib();
    normal = normal_clang;
  }

  if (opts.target === "ts") {
    await build_runtime(file, "ts");
    var Runtime = await import((new URL("./../bin/Runtime.ts", import.meta.url)).pathname);
    normal = Runtime.normal;
  }

  // Builds runtime memory
  // ---------------------

  if (opts.core) {
    var mem = Crusher.read_term(code);
  } else {
    var mem = Crusher.init();
    Crusher.link(mem, 0, Crusher.lnk(Crusher.CAL, name_table["main"] || 0, 0, 0));
  }

  // Evaluates main()
  // ----------------

  if (normal !== null) {
    var gas = normal(mem, 0);
    console.log(Convert.crusher_to_lambolt(mem, Crusher.deref(mem,0), numb_table));
    console.log("");
    console.log("* gas: " + gas);
    console.log("* mem: " + mem.lnk.size);
  } else {
    console.log("Couldn't load runtime.");
  }
}
