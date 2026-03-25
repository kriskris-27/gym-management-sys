import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma-optimized"

export async function GET() {
  try {
    console.log(`\n=== DEBUG FINANCIAL SERVICE LOGIC ===`)
    
    const memberId = "cmn53ptvt001k6eay3jlox1s8"
    
    // Get member data
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        name: true,
        membershipType: true,
        customPrice: true,
        lastRenewalAt: true,
        startDate: true,
        endDate: true,
        status: true
      }
    })
    
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }
    
    console.log(`Member: ${member.name}`)
    console.log(`lastRenewalAt: ${member.lastRenewalAt}`)
    console.log(`startDate: ${member.startDate}`)
    
    // Get all payments
    const allPayments = await prisma.payment.findMany({
      where: { memberId },
      select: {
        id: true,
        amount: true,
        date: true,
        createdAt: true,
        mode: true,
        notes: true
      },
      orderBy: { date: 'asc' }
    })
    
    console.log(`\nAll payments (${allPayments.length}):`)
    allPayments.forEach(p => {
      console.log(`  - ₹${p.amount} on ${p.date.toISOString()} (${p.notes})`)
    })
    
    // Calculate period start
    const periodStart = member.lastRenewalAt ?? member.startDate
    console.log(`\nPeriod start: ${periodStart.toISOString()}`)
    
    // Build payment filter (same as financial service)
    const paymentWhere = {
      memberId: member.id,
      date: { 
        gte: periodStart
      }
    }
    
    if (member.status === "ACTIVE" && member.endDate) {
      paymentWhere.date = { 
        ...paymentWhere.date,
        lte: new Date(member.endDate.toISOString().split('T')[0])
      }
    }
    
    console.log(`\nPayment filter:`, paymentWhere)
    
    // Get filtered payments
    const filteredPayments = await prisma.payment.findMany({
      where: paymentWhere,
      select: {
        id: true,
        amount: true,
        date: true,
        notes: true
      }
    })
    
    console.log(`\nFiltered payments (${filteredPayments.length}):`)
    filteredPayments.forEach(p => {
      console.log(`  - ₹${p.amount} on ${p.date.toISOString()} (${p.notes})`)
    })
    
    // Calculate totals
    const totalPaid = filteredPayments.reduce((sum, p) => sum + p.amount, 0)
    const planPrice = 8000 // Annual plan price
    const totalAmount = member.customPrice ?? planPrice
    const remaining = totalAmount - totalPaid
    
    console.log(`\nCalculation:`)
    console.log(`  Plan Amount: ₹${totalAmount}`)
    console.log(`  Total Paid: ₹${totalPaid}`)
    console.log(`  Remaining: ₹${remaining}`)
    
    console.log(`=== END DEBUG ===\n`)
    
    return NextResponse.json({
      member,
      periodStart: periodStart.toISOString(),
      paymentFilter: paymentWhere,
      allPayments: allPayments.map(p => ({
        ...p,
        date: p.date.toISOString(),
        shouldInclude: p.date >= periodStart
      })),
      filteredPayments: filteredPayments.map(p => ({
        ...p,
        date: p.date.toISOString()
      })),
      calculation: {
        totalAmount,
        totalPaid,
        remaining
      }
    })
    
  } catch (error) {
    console.error("[Debug Financial] Error:", error)
    return NextResponse.json({ error: "Debug failed" }, { status: 500 })
  }
}
