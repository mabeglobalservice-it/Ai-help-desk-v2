import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/client';
import { ATTACHMENTS_ROOT } from './attachments.constants';

const UPLOADER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
} as const;

interface Requester {
  userId: string;
  role: Role;
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async findTicketOrThrow(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    }

    return ticket;
  }

  private async safeDelete(filePath: string) {
    try {
      await unlink(filePath);
    } catch {
      // best-effort cleanup; nothing to do if the file is already gone
    }
  }

  // RM-04: memes bornes de visibilite que le ticket lui-meme (voir
  // TicketsService.assertTicketVisible) — sinon un employe ou technicien
  // pourrait lister/telecharger les pieces jointes d'un ticket auquel il
  // n'a pas acces.
  private canAccessTicket(
    ticket: { employeeId: string; technicianId: string | null },
    requester: Requester,
  ) {
    const isOwner = ticket.employeeId === requester.userId;
    const isAssignedTechnician = ticket.technicianId === requester.userId;
    const isPrivileged =
      requester.role === Role.SUPERVISOR || requester.role === Role.ADMIN;
    return isOwner || isAssignedTechnician || isPrivileged;
  }

  async findAllForTicket(ticketId: string, requester: Requester) {
    const ticket = await this.findTicketOrThrow(ticketId);

    if (!this.canAccessTicket(ticket, requester)) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }

    return this.prisma.ticketAttachment.findMany({
      where: { ticketId },
      include: { uploadedBy: { select: UPLOADER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOneOrThrow(
    ticketId: string,
    attachmentId: string,
    requester: Requester,
  ) {
    const ticket = await this.findTicketOrThrow(ticketId);

    if (!this.canAccessTicket(ticket, requester)) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }

    const attachment = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      include: { uploadedBy: { select: UPLOADER_SELECT } },
    });

    if (!attachment || attachment.ticketId !== ticketId) {
      throw new NotFoundException(`Pièce jointe ${attachmentId} introuvable`);
    }

    return attachment;
  }

  // docs/11-documentation-api.md, module Tickets: POST /tickets/:id/attachments
  // reserve a l'employe proprietaire et au technicien assigne (meme regle que les commentaires)
  async create(
    ticketId: string,
    requester: Requester,
    file: Express.Multer.File,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      await this.safeDelete(file.path);
      throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    }

    if (!this.canAccessTicket(ticket, requester)) {
      await this.safeDelete(file.path);
      throw new ForbiddenException(
        "Vous n'êtes pas autorisé à joindre un fichier à ce ticket",
      );
    }

    return this.prisma.ticketAttachment.create({
      data: {
        ticketId,
        uploadedById: requester.userId,
        fileName: file.originalname,
        storedFileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
      },
      include: { uploadedBy: { select: UPLOADER_SELECT } },
    });
  }

  resolveFilePath(ticketId: string, storedFileName: string) {
    return join(ATTACHMENTS_ROOT, ticketId, storedFileName);
  }
}
