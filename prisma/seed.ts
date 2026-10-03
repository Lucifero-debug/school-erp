// prisma/seed.ts
//
// One school with a believable term already in progress: classes VI to X,
// two sections each, ~50 students, a fee structure, four quarterly
// installments, demands raised for Q1 and Q2, and a mix of fully paid,
// part paid and defaulting students — so the defaulter list and the
// collection report have something real in them on first run.
//
// Run: npm run db:seed

import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const db = new PrismaClient();

// Same algorithm as lib/auth.ts. Duplicated because the seed runs
// outside Next and importing that module pulls in next/headers.
function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const DEMO_PASSWORD = "school123";

const FIRST = [
  "Aarav", "Vihaan", "Aditya", "Ishaan", "Kabir", "Arjun", "Reyansh", "Atharv",
  "Ananya", "Diya", "Saanvi", "Aadhya", "Myra", "Anika", "Navya", "Kiara",
  "Rehan", "Zoya", "Imran", "Fatima", "Harleen", "Gurnoor", "Tanvi", "Rishab",
  "Meher", "Vivaan",
];

const LAST = [
  "Sharma", "Verma", "Gupta", "Mehta", "Singh", "Khan", "Iyer", "Nair",
  "Bhatia", "Chopra", "Kaur", "Reddy", "Das", "Joshi",
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function dateOf(month: number, day: number, year = new Date().getFullYear()) {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Academic year: April to March. "2026-27".
function academicYearName(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

async function main() {
  console.log("seeding...");

  const yearName = academicYearName();
  const yearStart = Number(yearName.slice(0, 4));

  const school = await db.school.create({
    data: {
      name: "Nehru Public School",
      udiseCode: "07040203201",
      affiliationNo: "2730412",
      board: "CBSE",
      address: "Block C, Vikas Puri",
      city: "New Delhi",
      state: "Delhi",
      pincode: "110018",
      phone: "01128543210",
      email: "office@nps.example.in",
    },
  });

  const year = await db.academicYear.create({
    data: {
      schoolId: school.id,
      name: yearName,
      startsOn: dateOf(4, 1, yearStart),
      endsOn: dateOf(3, 31, yearStart + 1),
      isCurrent: true,
    },
  });

  // --- staff ------------------------------------------------------

  const [admin, accountant, teacherA, teacherB] = await Promise.all([
    db.staff.create({
      data: {
        schoolId: school.id,
        name: "Sunita Rao",
        phone: "9810000001",
        role: "ADMIN",
        designation: "Director",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    }),
    db.staff.create({
      data: {
        schoolId: school.id,
        name: "Ramesh Kulkarni",
        phone: "9810000002",
        role: "ACCOUNTANT",
        designation: "Accounts Officer",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    }),
    db.staff.create({
      data: {
        schoolId: school.id,
        name: "Priya Menon",
        phone: "9810000003",
        role: "TEACHER",
        qualification: "M.Sc, B.Ed",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    }),
    db.staff.create({
      data: {
        schoolId: school.id,
        name: "Imtiaz Ahmed",
        phone: "9810000004",
        role: "TEACHER",
        qualification: "M.A, B.Ed",
        passwordHash: hashPassword(DEMO_PASSWORD),
      },
    }),
  ]);

  await db.staff.create({
    data: {
      schoolId: school.id,
      name: "Kavita Joshi",
      phone: "9810000005",
      role: "CLERK",
      passwordHash: hashPassword(DEMO_PASSWORD),
    },
  });

  // --- classes and sections ---------------------------------------

  const classNames = ["VI", "VII", "VIII", "IX", "X"];
  const klasses = [];

  for (let i = 0; i < classNames.length; i++) {
    const k = await db.klass.create({
      data: { schoolId: school.id, name: classNames[i], rank: i + 6 },
    });

    const sections = await Promise.all(
      ["A", "B"].map((s, j) =>
        db.section.create({
          data: {
            klassId: k.id,
            name: s,
            capacity: 40,
            classTeacherId:
              i === 0 ? (j === 0 ? teacherA.id : teacherB.id) : null,
          },
        })
      )
    );

    klasses.push({ klass: k, sections });
  }

  // --- subjects ---------------------------------------------------

  const subjectNames = [
    "English", "Hindi", "Mathematics", "Science", "Social Science",
  ];

  const subjects = await Promise.all(
    subjectNames.map((name) =>
      db.subject.create({ data: { schoolId: school.id, name } })
    )
  );

  await db.subject.createMany({
    data: [
      { schoolId: school.id, name: "Work Education", isScholastic: false },
      { schoolId: school.id, name: "Art Education", isScholastic: false },
      { schoolId: school.id, name: "Health and Physical Education", isScholastic: false },
    ],
  });

  // --- fee heads ---------------------------------------------------

  const [tuition, exam, annual, admission, transport, caution, lateFee] =
    await Promise.all([
      db.feeHead.create({ data: { schoolId: school.id, name: "Tuition fee" } }),
      db.feeHead.create({ data: { schoolId: school.id, name: "Examination fee" } }),
      db.feeHead.create({ data: { schoolId: school.id, name: "Annual charges" } }),
      db.feeHead.create({ data: { schoolId: school.id, name: "Admission fee" } }),
      db.feeHead.create({ data: { schoolId: school.id, name: "Transport fee" } }),
      db.feeHead.create({
        data: { schoolId: school.id, name: "Caution money", refundable: true },
      }),
      db.feeHead.create({
        data: { schoolId: school.id, name: "Late fee", isLateFee: true },
      }),
    ]);

  void admission;
  void caution;
  void lateFee;

  // Tuition rises with the class. Everything else is flat.
  for (let i = 0; i < klasses.length; i++) {
    const structure = await db.feeStructure.create({
      data: { academicYearId: year.id, klassId: klasses[i].klass.id },
    });

    await db.feeStructureItem.createMany({
      data: [
        {
          structureId: structure.id,
          feeHeadId: tuition.id,
          amount: 1800 + i * 200, // VI 1800 ... X 2600 per month
          frequency: "MONTHLY",
        },
        {
          structureId: structure.id,
          feeHeadId: exam.id,
          amount: 600,
          frequency: "QUARTERLY",
        },
        {
          structureId: structure.id,
          feeHeadId: annual.id,
          amount: 4500,
          frequency: "ANNUAL",
        },
      ],
    });
  }

  // --- installments: quarterly -------------------------------------

  const installmentSpec = [
    { seq: 1, name: "Quarter 1 (Apr–Jun)", due: dateOf(4, 10, yearStart) },
    { seq: 2, name: "Quarter 2 (Jul–Sep)", due: dateOf(7, 10, yearStart) },
    { seq: 3, name: "Quarter 3 (Oct–Dec)", due: dateOf(10, 10, yearStart) },
    { seq: 4, name: "Quarter 4 (Jan–Mar)", due: dateOf(1, 10, yearStart + 1) },
  ];

  const installments = [];

  for (const spec of installmentSpec) {
    installments.push(
      await db.feeInstallment.create({
        data: {
          academicYearId: year.id,
          seq: spec.seq,
          name: spec.name,
          dueOn: spec.due,
          lateFeeAfterDays: 10,
          lateFeePerDay: 20,
          lateFeeMax: 1000,
        },
      })
    );
  }

  // --- students -----------------------------------------------------

  const students: { id: string; enrollmentId: string; klassIndex: number }[] =
    [];

  let admissionSeq = 0;

  for (let k = 0; k < klasses.length; k++) {
    for (let s = 0; s < klasses[k].sections.length; s++) {
      const count = 5; // 5 per section = 50 students

      for (let n = 0; n < count; n++) {
        admissionSeq++;

        const first = pick(FIRST, admissionSeq * 3);
        const last = pick(LAST, admissionSeq * 5);

        const student = await db.student.create({
          data: {
            schoolId: school.id,
            admissionNo: `${yearStart}/${String(admissionSeq).padStart(4, "0")}`,
            firstName: first,
            lastName: last,
            dob: dateOf(
              ((admissionSeq * 7) % 12) + 1,
              ((admissionSeq * 3) % 28) + 1,
              yearStart - (11 + k)
            ),
            gender: admissionSeq % 2 === 0 ? "FEMALE" : "MALE",
            category: admissionSeq % 9 === 0 ? "EWS" : "GENERAL",
            address: `House ${100 + admissionSeq}, Vikas Puri`,
            city: "New Delhi",
            admittedOn: dateOf(4, 1, yearStart),
            guardians: {
              create: [
                {
                  relation: "FATHER",
                  name: `${pick(FIRST, admissionSeq * 11)} ${last}`,
                  phone: `98${String(20000000 + admissionSeq * 137).slice(0, 8)}`,
                  isPrimary: true,
                  consentGivenAt: dateOf(4, 1, yearStart),
                  consentMethod: "admission form",
                  messagingConsent: admissionSeq % 7 !== 0,
                },
              ],
            },
          },
        });

        const enrollment = await db.enrollment.create({
          data: {
            studentId: student.id,
            academicYearId: year.id,
            sectionId: klasses[k].sections[s].id,
            rollNo: n + 1,
          },
        });

        students.push({
          id: student.id,
          enrollmentId: enrollment.id,
          klassIndex: k,
        });

        // A few concessions, so the fee engine has something to apply.
        if (admissionSeq % 9 === 0) {
          await db.concession.create({
            data: {
              studentId: student.id,
              type: "PERCENT",
              value: 100,
              reason: "RTE",
              note: "RTE 25% quota — state reimbursed",
              approvedById: admin.id,
              approvedAt: dateOf(4, 1, yearStart),
            },
          });
        } else if (admissionSeq % 11 === 0) {
          await db.concession.create({
            data: {
              studentId: student.id,
              feeHeadId: tuition.id,
              type: "PERCENT",
              value: 25,
              reason: "SIBLING",
              approvedById: admin.id,
              approvedAt: dateOf(4, 1, yearStart),
            },
          });
        } else if (admissionSeq % 17 === 0) {
          await db.concession.create({
            data: {
              studentId: student.id,
              type: "PERCENT",
              value: 50,
              reason: "STAFF_WARD",
              approvedById: admin.id,
              approvedAt: dateOf(4, 1, yearStart),
            },
          });
        }
      }
    }
  }

  // --- demands for Q1 and Q2 ----------------------------------------
  //
  // Mirrors lib/fees.ts generateDemands(). Kept inline so the seed does
  // not depend on app code, but the arithmetic must match: a monthly
  // head is charged 3x in a quarterly installment, an annual head only
  // in installment 1.

  const structures = await db.feeStructure.findMany({
    where: { academicYearId: year.id },
    include: { items: { include: { feeHead: true } } },
  });

  const structureByKlass = new Map(structures.map((s) => [s.klassId, s]));

  const concessions = await db.concession.findMany({
    where: { student: { schoolId: school.id } },
  });

  const concessionsByStudent = new Map<string, typeof concessions>();

  for (const c of concessions) {
    const list = concessionsByStudent.get(c.studentId) ?? [];
    list.push(c);
    concessionsByStudent.set(c.studentId, list);
  }

  function discountFor(
    gross: number,
    feeHeadId: string,
    studentId: string
  ): { amount: number; reason: string | null } {
    const all = concessionsByStudent.get(studentId) ?? [];

    const applicable = all.filter(
      (c) => c.feeHeadId === null || c.feeHeadId === feeHeadId
    );

    if (applicable.length === 0) return { amount: 0, reason: null };

    const specific = applicable.filter((c) => c.feeHeadId === feeHeadId);
    const pool = specific.length > 0 ? specific : applicable;

    let best = { amount: 0, reason: null as string | null };

    for (const c of pool) {
      const amount =
        c.type === "PERCENT"
          ? Math.round((gross * Number(c.value)) / 100)
          : Number(c.value);

      const capped = Math.min(amount, gross);

      if (capped > best.amount) best = { amount: capped, reason: c.reason };
    }

    return best;
  }

  const demandIds: { id: string; studentId: string; net: number }[] = [];

  for (const inst of installments.slice(0, 2)) {
    for (const s of students) {
      const klassId = klasses[s.klassIndex].klass.id;
      const structure = structureByKlass.get(klassId);
      if (!structure) continue;

      const lines: {
        feeHeadId: string;
        description: string;
        gross: number;
        concession: number;
        net: number;
        concessionReason: string | null;
      }[] = [];

      for (const item of structure.items) {
        if (item.feeHead.isLateFee) continue;

        let times = 0;

        if (item.frequency === "MONTHLY") times = 3; // quarterly billing
        else if (item.frequency === "QUARTERLY") times = 1;
        else if (item.frequency === "ANNUAL") times = inst.seq === 1 ? 1 : 0;
        else if (item.frequency === "ONE_TIME") times = inst.seq === 1 ? 1 : 0;

        if (times === 0) continue;

        const gross = Number(item.amount) * times;
        const d = discountFor(gross, item.feeHeadId, s.id);

        lines.push({
          feeHeadId: item.feeHeadId,
          description: item.feeHead.name,
          gross,
          concession: d.amount,
          net: gross - d.amount,
          concessionReason: d.reason,
        });
      }

      if (lines.length === 0) continue;

      const gross = lines.reduce((t, l) => t + l.gross, 0);
      const concession = lines.reduce((t, l) => t + l.concession, 0);
      const net = gross - concession;

      const demand = await db.feeDemand.create({
        data: {
          studentId: s.id,
          enrollmentId: s.enrollmentId,
          installmentId: inst.id,
          dueOn: inst.dueOn,
          gross,
          concession,
          net,
          lines: { create: lines },
        },
      });

      demandIds.push({ id: demand.id, studentId: s.id, net });
    }
  }

  // --- receipts: most paid, some part paid, some defaulting ---------

  const byStudent = new Map<string, typeof demandIds>();

  for (const d of demandIds) {
    const list = byStudent.get(d.studentId) ?? [];
    list.push(d);
    byStudent.set(d.studentId, list);
  }

  let receiptSeq = 0;
  let studentIndex = 0;

  for (const [studentId, demands] of byStudent) {
    studentIndex++;

    // 10% default entirely, 15% pay only the first quarter, the rest
    // are square. Zero-value demands (full RTE concession) are already
    // settled and need no receipt.
    const behaviour =
      studentIndex % 10 === 0
        ? "none"
        : studentIndex % 7 === 0
          ? "partial"
          : "full";

    if (behaviour === "none") continue;

    const toPay = behaviour === "partial" ? demands.slice(0, 1) : demands;

    for (const d of toPay) {
      if (d.net <= 0) {
        await db.feeDemand.update({
          where: { id: d.id },
          data: { status: "PAID" },
        });
        continue;
      }

      receiptSeq++;

      const receipt = await db.receipt.create({
        data: {
          academicYearId: year.id,
          studentId,
          number: `RCPT/${yearName}/${String(receiptSeq).padStart(5, "0")}`,
          amount: d.net,
          mode: receiptSeq % 3 === 0 ? "UPI" : receiptSeq % 3 === 1 ? "CASH" : "CHEQUE",
          reference: receiptSeq % 3 === 0 ? `42${receiptSeq}98217` : null,
          collectedById: accountant.id,
          receivedAt: dateOf(
            4 + (receiptSeq % 5),
            ((receiptSeq * 3) % 27) + 1,
            yearStart
          ),
          allocations: { create: [{ demandId: d.id, amount: d.net }] },
        },
      });

      void receipt;

      await db.feeDemand.update({
        where: { id: d.id },
        data: { paid: d.net, status: "PAID" },
      });
    }
  }

  // --- a couple of exams, unmarked, so the screens have shape -------

  const term1 = await db.exam.create({
    data: {
      academicYearId: year.id,
      name: "Term 1",
      type: "TERM",
      seq: 1,
      weightPercent: 40,
    },
  });

  for (const k of klasses) {
    for (const sub of subjects) {
      await db.examPaper.create({
        data: {
          examId: term1.id,
          klassId: k.klass.id,
          subjectId: sub.id,
          maxMarks: 80,
          passMarks: 26,
        },
      });
    }
  }

  const counts = {
    students: students.length,
    demands: demandIds.length,
    receipts: receiptSeq,
  };

  console.log(`
seeded ${school.name} — academic year ${yearName}

  ${counts.students} students · ${counts.demands} fee demands · ${counts.receipts} receipts

  sign in with any of these:
    9810000001   Sunita Rao        admin
    9810000002   Ramesh Kulkarni   accountant
    9810000003   Priya Menon       teacher (class VI-A)
    9810000005   Kavita Joshi      clerk

  password for all: ${DEMO_PASSWORD}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
